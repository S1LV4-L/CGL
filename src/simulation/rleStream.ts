import { formatRule } from './life.ts';
import { PackedLife } from './packedLife.ts';

export const MAX_LARGE_RLE_BYTES = 256 * 1024 * 1024;
/** Validate the entire input before exposing runs to a destructive import. No expanded board. */
export function inspectRle(text: string, columns: number, rows: number) {
    if (text.length > MAX_LARGE_RLE_BYTES)
        throw new Error('El archivo supera 256 MiB. Usá un estado binario.');
    const lines = text
        .replace(/^\uFEFF/, '')
        .split(/\r\n|\n|\r/)
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#'));
    const header =
        /^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)(?:\s*,\s*rule\s*=\s*(.+))?$/i.exec(
            lines[0] ?? '',
        );
    if (!header) throw new Error('Falta una cabecera RLE válida.');
    const width = Number(header[1]),
        height = Number(header[2]);
    if (
        !Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width > columns ||
        height > rows
    )
        throw new Error('El patrón no cabe en el tablero.');
    const notation = (header[3] ?? 'B3/S23').replace(/\s/g, '').toUpperCase();
    const normal = /^B([0-8]*)\/S([0-8]*)$/.exec(notation);
    const reverse =
        /^S([0-8]*)\/B([0-8]*)$/.exec(notation) ??
        /^([0-8]*)\/([0-8]*)$/.exec(notation);
    if (!normal && !reverse) throw new Error('Regla RLE no válida.');
    const rule = new Uint8Array(18);
    for (const n of normal ? normal[1] : reverse![2]) rule[Number(n)] = 1;
    for (const n of normal ? normal[2] : reverse![1]) rule[Number(n) + 9] = 1;
    const body = lines.slice(1).join('').replace(/\s/g, '');
    function visit(run?: (x: number, y: number, length: number) => void) {
        let x = 0,
            y = 0,
            count = 0,
            digits = false;
        for (let i = 0; i < body.length; i++) {
            const ch = body[i];
            if (ch >= '0' && ch <= '9') {
                count = count * 10 + Number(ch);
                digits = true;
                continue;
            }
            if (ch === '!') {
                if (digits || i !== body.length - 1)
                    throw new Error('Cierre RLE no válido.');
                return;
            }
            const n = digits ? count : 1;
            if (!Number.isSafeInteger(n) || n <= 0)
                throw new Error('Repetición RLE no válida.');
            count = 0;
            digits = false;
            if (ch === '$') {
                y += n;
                x = 0;
                if (y > height) throw new Error('El patrón excede su altura.');
            } else if (ch === 'b' || ch === 'o') {
                if (y >= height || x + n > width)
                    throw new Error('El patrón excede sus dimensiones.');
                if (ch === 'o') run?.(x, y, n);
                x += n;
            } else throw new Error(`Símbolo RLE no válido: ${ch}`);
        }
        throw new Error('El patrón debe terminar con !.');
    }
    visit();
    return { width, height, rule, visit };
}

/** Incremental file parser: header + one input chunk, even for an unwrapped RLE body. */
export async function readRleFile(
    file: Blob,
    columns: number,
    rows: number,
    run?: (x: number, y: number, length: number) => void,
) {
    if (file.size > MAX_LARGE_RLE_BYTES)
        throw new Error('El archivo supera 256 MiB.');
    const reader = file
        .stream()
        .pipeThrough(new TextDecoderStream())
        .getReader();
    let header = '',
        meta: ReturnType<typeof inspectRle> | undefined;
    let comment = false,
        lineStart = true,
        ended = false,
        x = 0,
        y = 0,
        count = 0,
        digits = false;
    const consume = (text: string) => {
        for (const ch of text) {
            if (ch === '\n' || ch === '\r') {
                if (!meta && header.trim()) {
                    meta = inspectRle(header + '\n!', columns, rows);
                    header = '';
                }
                lineStart = true;
                comment = false;
                continue;
            }
            if (comment) continue;
            if (lineStart && /\s/.test(ch)) continue;
            if (lineStart && ch === '#') {
                comment = true;
                continue;
            }
            lineStart = false;
            if (!meta) {
                header += ch;
                if (header.length > 4096)
                    throw new Error('Cabecera RLE demasiado larga.');
                continue;
            }
            if (/\s/.test(ch)) continue;
            if (ended)
                throw new Error(
                    'El cierre RLE debe ser único y estar al final.',
                );
            if (ch >= '0' && ch <= '9') {
                count = count * 10 + Number(ch);
                digits = true;
                continue;
            }
            if (ch === '!') {
                if (digits) throw new Error('Cierre RLE no válido.');
                ended = true;
                continue;
            }
            const n = digits ? count : 1;
            count = 0;
            digits = false;
            if (!Number.isSafeInteger(n) || n <= 0)
                throw new Error('Repetición RLE no válida.');
            if (ch === '$') {
                y += n;
                x = 0;
                if (y > meta.height)
                    throw new Error('El patrón excede su altura.');
            } else if (ch === 'b' || ch === 'o') {
                if (y >= meta.height || x + n > meta.width)
                    throw new Error('El patrón excede sus dimensiones.');
                if (ch === 'o') run?.(x, y, n);
                x += n;
            } else throw new Error(`Símbolo RLE no válido: ${ch}`);
        }
    };
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            consume(value);
        }
    } catch (error) {
        await reader.cancel();
        throw error;
    } finally {
        reader.releaseLock();
    }
    if (!meta || !ended)
        throw new Error('El patrón debe tener cabecera y terminar con !.');
    return { width: meta.width, height: meta.height, rule: meta.rule };
}

/** Bounded text chunks: never retain one string object per run. */
export function* exportRleChunks(sim: PackedLife, rule: Uint8Array) {
    let chunk = `x = ${sim.columns}, y = ${sim.rows}, rule = ${formatRule(rule)}\n`,
        line = '',
        previous = 0;
    const token = (n: number, tag: string) => `${n === 1 ? '' : n}${tag}`;
    function append(value: string) {
        if (line.length + value.length > 70) {
            chunk += line + '\n';
            line = '';
        }
        line += value;
    }
    for (let y = 0; y < sim.rows; y++) {
        let last = sim.columns - 1;
        // Skip entire empty words at row ends.
        let word = sim.stride - 1;
        while (word >= 0 && !sim.words[y * sim.stride + word]) word--;
        if (word < 0) continue;
        last = Math.min(
            last,
            word * 32 + 31 - Math.clz32(sim.words[y * sim.stride + word]),
        );
        if (y > previous) append(token(y - previous, '$'));
        previous = y;
        for (let x = 0; x <= last;) {
            const start = x,
                alive = sim.getCell(x++, y);
            while (x <= last && sim.getCell(x, y) === alive) x++;
            append(token(x - start, alive ? 'o' : 'b'));
            if (chunk.length >= 65536) {
                yield chunk;
                chunk = '';
            }
        }
    }
    append('!');
    yield chunk + line + '\n';
}

export function checkpoint(
    sim: PackedLife,
    rule: Uint8Array,
    generation: number,
): Blob {
    const header = new ArrayBuffer(48),
        view = new DataView(header);
    view.setUint32(0, 0x324c4743, true); // CGL2, little endian.
    view.setUint32(4, sim.columns, true);
    view.setUint32(8, sim.rows, true);
    view.setFloat64(16, generation, true);
    new Uint8Array(header, 24, 18).set(rule);
    return new Blob([header, sim.words], { type: 'application/octet-stream' });
}

export async function readCheckpoint(file: Blob) {
    const buffer = await file.arrayBuffer(),
        view = new DataView(buffer);
    if (buffer.byteLength < 48 || view.getUint32(0, true) !== 0x324c4743)
        throw new Error('Estado binario no válido.');
    const columns = view.getUint32(4, true),
        rows = view.getUint32(8, true),
        generation = view.getFloat64(16, true);
    const rule = new Uint8Array(buffer, 24, 18).slice();
    if (
        !Number.isSafeInteger(generation) ||
        generation < 0 ||
        rule.some((n) => n > 1) ||
        buffer.byteLength !== 48 + Math.ceil(columns / 32) * rows * 4
    )
        throw new Error('Estado binario dañado.');
    const words = new Uint32Array(buffer, 48);
    const mask = 0xffffffff >>> (32 - (((columns - 1) & 31) + 1)),
        stride = Math.ceil(columns / 32);
    for (let y = 0; y < rows; y++)
        if ((words[y * stride + stride - 1] & ~mask) !== 0)
            throw new Error('Bits de relleno no válidos.');
    return { columns, rows, generation, rule, words };
}
