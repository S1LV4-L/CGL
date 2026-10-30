/// <reference lib="webworker" />
import { PackedLife, resizePacked } from './packedLife.ts';
import { getPresetRule } from './life.ts';
import { GpuLife } from './gpuLife.ts';
import {
    checkpoint,
    exportRleChunks,
    inspectRle,
    MAX_LARGE_RLE_BYTES,
    readCheckpoint,
    readRleFile,
} from './rleStream.ts';
import { validBoardSize } from './resize.ts';
import { OccupancyPyramid, rasterize } from '../rendering/packedRenderer.ts';
import type { Camera } from '../rendering/camera.ts';
import type { Command, Engine, Envelope, Metrics } from './runtime.ts';

const scope = self as DedicatedWorkerGlobalScope;
let sim: PackedLife;
let pyramid: OccupancyPyramid;
let gpu: GpuLife | null = null,
    gpuAttempted = false;
let engine: Engine = 'cpu';
let rule = getPresetRule('conway'),
    mutation = false,
    playing = false,
    interval = 100;
let generation = 0,
    stepMs = 0,
    drawMs = 0,
    notice = '',
    backend = 'CPU · disperso';
let camera: Camera = { x: 6000, y: 4000, scale: 5 },
    width = 1,
    height = 1;
let canvas: OffscreenCanvas | null = null,
    pixels = new Uint32Array(0);
let lastFrame = -Infinity,
    lastMetrics = 0,
    metricGeneration = 0;
let drawPending = true,
    frameInFlight = false,
    strokeValue = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
let queue = Promise.resolve();
let rendering: Promise<void> | null = null;

function enqueue(action: () => Promise<void>) {
    queue = queue.then(action).catch((error) => {
        playing = false;
        clearTimeout(timer);
        notice = error instanceof Error ? error.message : String(error);
        scope.postMessage({ type: 'error', message: notice });
        report(true);
    });
}
function report(force = false) {
    const now = performance.now(),
        elapsed = now - lastMetrics;
    if (!force && elapsed < 250) return;
    const metrics: Metrics = {
        generation,
        stepMs,
        drawMs,
        gps:
            elapsed > 0
                ? ((generation - metricGeneration) * 1000) / elapsed
                : 0,
        active: gpu ? -1 : sim.activeCount / sim.tileCount,
        engine: backend,
        columns: sim.columns,
        rows: sim.rows,
        stateBytes: sim.stateBytes,
        notice,
    };
    scope.postMessage({ type: 'metrics', metrics });
    lastMetrics = now;
    metricGeneration = generation;
}
async function cpu() {
    if (!gpu) return;
    const words = await gpu.download();
    gpu.destroy();
    gpu = null;
    gpuAttempted = false;
    sim.replace(words);
    pyramid = new OccupancyPyramid(sim.columns, sim.rows);
    backend = 'CPU · listo';
}
async function selectEngine() {
    if (engine === 'cpu') {
        await cpu();
        return;
    }
    if (
        !gpu &&
        !gpuAttempted &&
        (engine === 'gpu' ||
            (sim.columns * sim.rows >= 1048576 &&
                sim.activeCount > sim.tileCount / 2))
    ) {
        gpuAttempted = true;
        try {
            gpu = await GpuLife.create(sim);
            if (!gpu) notice = 'WebGPU no está disponible. Se usa CPU.';
        } catch (error) {
            notice = `Se usa CPU: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
}
async function step() {
    await selectEngine();
    const start = performance.now();
    if (gpu) {
        await gpu.step(rule, mutation);
        backend = 'GPU';
    } else {
        sim.step(rule, mutation);
        backend = `CPU · ${sim.lastPath}`;
    }
    stepMs = performance.now() - start;
    generation++;
    drawPending = true;
}
function draw(force = false): Promise<void> {
    const now = performance.now();
    // Keep expensive previews within roughly a quarter of the time budget.
    // Simulation may advance several times while a preview is being produced.
    const frameInterval = Math.max(1000 / 30, drawMs * 4);
    if (
        rendering ||
        !drawPending ||
        frameInFlight ||
        (!force && now - lastFrame < frameInterval)
    )
        return Promise.resolve();
    const task = renderFrame();
    rendering = task;
    // Both callers and the playback error handler observe failures; release the
    // lifetime guard even if producing the image fails.
    void task
        .finally(() => {
            if (rendering === task) rendering = null;
        })
        .catch(() => {});
    return task;
}
async function renderFrame() {
    const start = performance.now();
    lastFrame = start;
    drawPending = false;
    frameInFlight = true;
    try {
        let bitmap: ImageBitmap;
        if (gpu) bitmap = await gpu.draw(camera, width, height);
        else {
            if (!canvas) canvas = new OffscreenCanvas(width, height);
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            if (pixels.length !== width * height)
                pixels = new Uint32Array(width * height);
            rasterize(sim, pyramid, camera, width, height, pixels);
            canvas
                .getContext('2d')!
                .putImageData(
                    new ImageData(
                        new Uint8ClampedArray(pixels.buffer as ArrayBuffer),
                        width,
                        height,
                    ),
                    0,
                    0,
                );
            bitmap = canvas.transferToImageBitmap();
        }
        drawMs = performance.now() - start;
        scope.postMessage({ type: 'frame', bitmap }, [bitmap]);
    } catch (error) {
        frameInFlight = false;
        drawPending = true;
        throw error;
    }
}
function schedule(delay = 0) {
    clearTimeout(timer);
    if (!playing) return;
    timer = setTimeout(
        () =>
            enqueue(async () => {
                if (!playing) return;
                const start = performance.now();
                await step();
                // Rendering runs independently. Mutating commands wait for it
                // below, so a motor switch cannot destroy resources in use.
                void draw().catch((error) => {
                    playing = false;
                    clearTimeout(timer);
                    notice =
                        error instanceof Error ? error.message : String(error);
                    scope.postMessage({ type: 'error', message: notice });
                    report(true);
                });
                report();
                schedule(Math.max(0, interval - (performance.now() - start)));
            }),
        delay,
    );
}
function fresh(next: PackedLife) {
    gpu?.destroy();
    gpu = null;
    gpuAttempted = false;
    sim = next;
    pyramid = new OccupancyPyramid(sim.columns, sim.rows);
    generation = 0;
    stepMs = 0;
    backend = 'CPU · disperso';
    metricGeneration = 0;
    drawPending = true;
}
async function command(message: Command) {
    if (message.type !== 'view' && rendering) await rendering.catch(() => {});
    switch (message.type) {
        case 'init':
            if (!validBoardSize(message.columns, message.rows))
                throw new Error('Tamaño no válido.');
            fresh(new PackedLife(message.columns, message.rows));
            camera = { x: sim.columns / 2, y: sim.rows / 2, scale: 5 };
            break;
        case 'configure': {
            const selected = message.engine ?? 'cpu';
            if (engine !== selected) {
                gpuAttempted = false;
                notice = '';
            }
            engine = selected;
            rule = message.rule;
            mutation = message.mutation;
            playing = message.playing;
            interval = message.interval;
            if (engine === 'cpu' || !playing) await cpu();
            schedule();
            break;
        }
        case 'view':
            camera = message.camera;
            width = Math.max(1, Math.min(8192, Math.round(message.width)));
            height = Math.max(1, Math.min(8192, Math.round(message.height)));
            drawPending = true;
            break;
        case 'step':
            if (!playing) await step();
            break;
        case 'reset':
            gpu?.destroy();
            gpu = null;
            gpuAttempted = false;
            sim.reset();
            notice = '';
            backend = 'CPU · disperso';
            generation = 0;
            metricGeneration = 0;
            drawPending = true;
            break;
        case 'paint': {
            await cpu();
            let { x0, y0 } = message;
            const { x1, y1 } = message;
            if (message.first) strokeValue = sim.getCell(x0, y0) ? 0 : 1;
            const dx = Math.abs(x1 - x0),
                dy = -Math.abs(y1 - y0),
                sx = x0 < x1 ? 1 : -1,
                sy = y0 < y1 ? 1 : -1;
            let error = dx + dy;
            while (true) {
                sim.setCell(x0, y0, strokeValue);
                if (x0 === x1 && y0 === y1) break;
                const twice = error * 2;
                if (twice >= dy) {
                    error += dy;
                    x0 += sx;
                }
                if (twice <= dx) {
                    error += dx;
                    y0 += sy;
                }
            }
            drawPending = true;
            break;
        }
        case 'stamp': {
            const header = /x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/i.exec(
                message.rle,
            );
            if (!header) throw new Error('Patrón no válido.');
            const pattern = inspectRle(
                message.rle,
                Number(header[1]),
                Number(header[2]),
            );
            await cpu();
            const sx = message.x - Math.floor(pattern.width / 2),
                sy = message.y - Math.floor(pattern.height / 2);
            pattern.visit((x, y, length) => sim.setRun(sx + x, sy + y, length));
            drawPending = true;
            break;
        }
        case 'resize': {
            if (!validBoardSize(message.columns, message.rows))
                throw new Error('Tamaño no válido.');
            playing = false;
            clearTimeout(timer);
            await cpu();
            const next = resizePacked(sim, message.columns, message.rows);
            fresh(next);
            break;
        }
        case 'load': {
            playing = false;
            clearTimeout(timer);
            if (message.file.name.toLowerCase().endsWith('.cgl')) {
                if (message.file.size > 48 + 4 * Math.ceil(12699 / 32) * 12699)
                    throw new Error('Estado binario demasiado grande.');
                const saved = await readCheckpoint(message.file);
                if (!validBoardSize(saved.columns, saved.rows))
                    throw new Error('Dimensiones no válidas.');
                const next = new PackedLife(saved.columns, saved.rows);
                next.replace(saved.words);
                fresh(next);
                rule = saved.rule;
                generation = saved.generation;
                metricGeneration = generation;
            } else {
                if (message.file.size > MAX_LARGE_RLE_BYTES)
                    throw new Error('El archivo supera 256 MiB.');
                const pattern = await readRleFile(
                    message.file,
                    sim.columns,
                    sim.rows,
                );
                const next = new PackedLife(sim.columns, sim.rows);
                const sx = Math.floor((sim.columns - pattern.width) / 2),
                    sy = Math.floor((sim.rows - pattern.height) / 2);
                await readRleFile(
                    message.file,
                    sim.columns,
                    sim.rows,
                    (x, y, length) => next.setRun(sx + x, sy + y, length),
                );
                // Atomic commit: even a failed second read preserves the previous state.
                fresh(next);
                rule = pattern.rule;
                generation = 0;
                metricGeneration = 0;
            }
            mutation = false;
            drawPending = true;
            await draw(true);
            report(true);
            return { rule, columns: sim.columns, rows: sim.rows };
        }
        case 'export-stream': {
            const writer = message.stream.getWriter();
            try {
                await cpu();
                const encoder = new TextEncoder();
                let length = 0;
                for (const chunk of exportRleChunks(sim, rule)) {
                    length += chunk.length;
                    if (length > MAX_LARGE_RLE_BYTES)
                        throw new Error(
                            'El RLE supera 256 MiB. Guardá el estado binario compacto.',
                        );
                    await writer.write(encoder.encode(chunk));
                }
                await writer.close();
            } catch (error) {
                await writer.abort(error);
                throw error;
            } finally {
                writer.releaseLock();
            }
            break;
        }
        case 'export': {
            await cpu();
            if (message.format === 'binary')
                return checkpoint(sim, rule, generation);
            const parts: string[] = [];
            let length = 0;
            for (const chunk of exportRleChunks(sim, rule)) {
                length += chunk.length;
                if (length > MAX_LARGE_RLE_BYTES)
                    throw new Error(
                        'El RLE supera 256 MiB. Guardá el estado binario compacto.',
                    );
                parts.push(chunk);
            }
            return new Blob(parts, { type: 'text/plain;charset=utf-8' });
        }
    }
    await draw(true);
    report(true);
}

scope.onmessage = ({
    data,
}: MessageEvent<Envelope | { type: 'frame-consumed' }>) => {
    if ('type' in data) {
        frameInFlight = false;
        if (!playing && drawPending)
            enqueue(async () => {
                await draw(true);
                report();
            });
        return;
    }
    if (
        (data.command.type === 'configure' && !data.command.playing) ||
        ['load', 'resize', 'reset'].includes(data.command.type)
    ) {
        playing = false;
        clearTimeout(timer);
    }
    enqueue(async () => {
        try {
            const value = await command(data.command);
            if (data.id)
                scope.postMessage({ type: 'reply', id: data.id, value });
        } catch (error) {
            playing = false;
            clearTimeout(timer);
            const message =
                error instanceof Error ? error.message : String(error);
            if (data.id)
                scope.postMessage({
                    type: 'reply',
                    id: data.id,
                    error: message,
                });
            else scope.postMessage({ type: 'error', message });
        }
    });
};
