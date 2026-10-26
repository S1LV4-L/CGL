import type { Board, GameMode } from "./life";
import { formatRule, getPresetRule, getRuleMode } from "./life.ts";

const RULES: Record<GameMode, string> = { conway: "B3/S23", seeds: "B2/S" };
export const MAX_RLE_FILE_SIZE = 1024 * 1024;

/** Lee RLE binario y centra sus dimensiones declaradas en el tablero. */
export function parseRle(text: string, columns: number, rows: number) {
    if (text.length > MAX_RLE_FILE_SIZE) throw new Error("El archivo supera el límite de 1 MB.");
    const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)
        .map(line => line.trim()).filter(line => line && !line.startsWith("#"));
    const header = /^x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)(?:\s*,\s*rule\s*=\s*(.+))?$/i.exec(lines[0] ?? "");
    if (!header) throw new Error("Falta una cabecera RLE válida: x = ancho, y = alto, rule = B3/S23.");
    const width = Number(header[1]);
    const height = Number(header[2]);
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width > columns || height > rows) {
        throw new Error(`El patrón no cabe en el tablero de ${columns} × ${rows} células.`);
    }
    const rule = (header[3] ?? RULES.conway).replace(/\s/g, "").toUpperCase();
    const parts = /^B([0-8]*)\/S([0-8]*)$/.exec(rule);
    const reversed = /^S([0-8]*)\/B([0-8]*)$/.exec(rule) ?? /^([0-8]*)\/([0-8]*)$/.exec(rule);
    if (!parts && !reversed) throw new Error(`Regla no válida: ${header[3]}. Use B/S con vecinos de 0 a 8.`);
    const rules = new Uint8Array(18);
    for (const digit of (parts ? parts[1] : reversed![2])) rules[Number(digit)] = 1;
    for (const digit of (parts ? parts[2] : reversed![1])) rules[9 + Number(digit)] = 1;
    const mode = getRuleMode(rules);

    const board: Board = new Uint8Array(columns * rows);
    const offsetX = Math.floor((columns - width) / 2);
    const offsetY = Math.floor((rows - height) / 2);
    const body = lines.slice(1).join("").replace(/\s/g, "");
    let x = 0;
    let y = 0;
    let digits = "";
    for (let index = 0; index < body.length; index++) {
        const tag = body[index];
        if (/\d/.test(tag)) {
            digits += tag;
            continue;
        }
        if (tag === "!") {
            if (digits || index !== body.length - 1) throw new Error("El cierre RLE debe ser un único ! al final del patrón.");
            return { board, mode, rules, width, height };
        }
        const count = digits ? Number(digits) : 1;
        digits = "";
        if (!Number.isSafeInteger(count) || count <= 0) throw new Error("Las repeticiones RLE deben ser enteros positivos.");
        if (tag === "$") {
            y += count;
            x = 0;
            if (y > height) throw new Error("El patrón excede la altura declarada.");
        } else if (tag === "b" || tag === "o") {
            if (y >= height || x + count > width) throw new Error("El patrón excede las dimensiones declaradas.");
            if (tag === "o") {
                const start = (offsetY + y) * columns + offsetX + x;
                board.fill(1, start, start + count);
            }
            x += count;
        } else {
            throw new Error(`Símbolo RLE no válido: ${tag}. Se admiten b, o, $ y !.`);
        }
    }
    throw new Error("El patrón RLE debe terminar con !.");
}

/** Conserva las dimensiones y posiciones; omite las células muertas finales. */
export function serializeRle(board: Board, columns: number, rows: number, mode: GameMode | Uint8Array) {
    const tokens: string[] = [];
    const run = (count: number, tag: string) => `${count === 1 ? "" : count}${tag}`;
    let previousRow = 0;
    for (let y = 0; y < rows; y++) {
        let lastLive = columns - 1;
        while (lastLive >= 0 && board[y * columns + lastLive] === 0) lastLive--;
        if (lastLive < 0) continue;
        if (y > previousRow) tokens.push(run(y - previousRow, "$"));
        previousRow = y;
        let x = 0;
        while (x <= lastLive) {
            const value = board[y * columns + x];
            const start = x++;
            while (x <= lastLive && board[y * columns + x] === value) x++;
            tokens.push(run(x - start, value ? "o" : "b"));
        }
    }
    tokens.push("!");
    const lines: string[] = [];
    let line = "";
    for (const token of tokens) {
        if (line.length + token.length > 70) {
            lines.push(line);
            line = "";
        }
        line += token;
    }
    lines.push(line);
    const rule = typeof mode === "string" ? getPresetRule(mode) : mode;
    return `x = ${columns}, y = ${rows}, rule = ${formatRule(rule)}\n${lines.join("\n")}\n`;
}
