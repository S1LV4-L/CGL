import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoardRenderer } from "../src/rendering/boardRenderer.ts";
import { createSimulation } from "../src/simulation/life.ts";

function setup(t, columns = 3, rows = 2) {
    const frames = new Map();
    let frameId = 0;
    const pixels = new Uint8Array(30 * 20);
    const calls = { fills: 0, gridStrokes: 0 };
    const context = {
        fillRect(x, y, width, height) {
            calls.fills++;
            for (let py = Math.max(0, Math.floor(y)); py < Math.min(20, Math.ceil(y + height)); py++) {
                for (let px = Math.max(0, Math.floor(x)); px < Math.min(30, Math.ceil(x + width)); px++) {
                    pixels[py * 30 + px] = this.fillStyle === "white" ? 1 : 0;
                }
            }
        },
    };
    const gridContext = {
        clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() { calls.gridStrokes++; },
    };
    const originals = Object.fromEntries(["requestAnimationFrame", "cancelAnimationFrame"]
        .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    t.after(() => {
        for (const [key, descriptor] of Object.entries(originals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const canvas = { width: 30, height: 20, getContext: () => context };
    const grid = { width: 30, height: 20, getContext: () => gridContext };
    const renderer = createBoardRenderer(canvas, grid, columns, rows, 10);
    const flush = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback());
    };
    const cells = () => [pixels[5 * 30 + 5], pixels[5 * 30 + 15], pixels[5 * 30 + 25],
        pixels[15 * 30 + 5], pixels[15 * 30 + 15], pixels[15 * 30 + 25]];
    return { renderer, pixels, calls, frames, flush, cells, canvas, grid };
}

test("agrupa generaciones y dibuja el último tablero en las coordenadas correctas", t => {
    const { renderer, frames, flush, cells, calls } = setup(t);
    renderer.renderBoard(new Uint8Array(6));
    const latest = new Uint8Array([1, 0, 1, 0, 1, 1]);
    renderer.renderBoard(latest);
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(cells(), [...latest]);
    assert.equal(calls.gridStrokes, 1);
});

test("las ediciones y reset se combinan y no dejan células antiguas", t => {
    const { renderer, frames, flush, cells, calls } = setup(t);
    const board = new Uint8Array(6);
    renderer.renderBoard(board);
    flush();
    board[5] = 1;
    renderer.renderCell(board);
    renderer.renderCell(board);
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(cells(), [...board]);
    renderer.renderCell(board);
    const reset = new Uint8Array(6);
    renderer.renderBoard(reset);
    flush();
    assert.deepEqual(cells(), [...reset]);
    assert.equal(calls.gridStrokes, 1);
});

test("pan y zoom redibujan tablero y grilla, ocultándola al alejar", t => {
    const { renderer, flush, cells, calls } = setup(t);
    renderer.renderBoard(new Uint8Array([1, 0, 0, 0, 0, 0]));
    renderer.setView({ x: 0.5, y: 1, scale: 10 });
    flush();
    assert.deepEqual(cells(), [0, 1, 0, 0, 0, 0]);
    renderer.setView({ x: 1.5, y: 1, scale: 5 });
    flush();
    assert.equal(calls.gridStrokes, 1);
    renderer.setView({ x: 1.5, y: 1, scale: 10 });
    flush();
    assert.equal(calls.gridStrokes, 2);
});

test("un tablero enorme solo se lee en su región visible y los canvas no crecen", t => {
    const { renderer, flush, canvas, grid } = setup(t, 12000, 8000);
    let reads = 0;
    const board = new Proxy({}, { get() { reads++; return 0; } });
    renderer.renderBoard(board);
    flush();
    assert.ok(reads <= 12);
    assert.equal(canvas.width, 30);
    assert.equal(grid.width, 30);
    renderer.resize(25, 15);
    flush();
    assert.equal(canvas.width, 25);
    assert.equal(grid.height, 15);
});

test("respeta los buffers reutilizados y dispose cancela el cuadro pendiente", t => {
    const { renderer, frames, flush, cells } = setup(t);
    const simulation = createSimulation(3, 2);
    simulation.board.set([0, 1, 1, 1, 0, 0]);
    for (let step = 0; step < 5; step++) {
        simulation.step("conway", false);
        renderer.renderBoard(simulation.board);
    }
    flush();
    assert.deepEqual(cells(), [...simulation.board]);
    renderer.renderBoard(simulation.board);
    renderer.dispose();
    assert.equal(frames.size, 0);
    renderer.renderBoard(simulation.board);
    assert.equal(frames.size, 0);
});
