import assert from "node:assert/strict";
import { test } from "node:test";
import { createBoardRenderer } from "../src/rendering/boardRenderer.ts";
import { createSimulation } from "../src/simulation/life.ts";

// Canvas y reloj controlados para verificar qué se pinta y cuántas veces,
// sin depender de la frecuencia de pantalla ni de un navegador instalado.
function setup(t) {
    const frames = new Map();
    const calls = { uploads: 0, draws: 0, fills: 0, gridStrokes: 0 };
    let frameId = 0;
    let uploadedImage;
    const visible = new Uint8Array(6).fill(2);
    const imageContext = {
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData(image) { calls.uploads++; uploadedImage = image; },
    };
    const context = {
        drawImage() {
            calls.draws++;
            for (let y = 0; y < 2; y++) {
                for (let x = 0; x < 3; x++) {
                    const offset = (y * 3 + x) * 4;
                    visible[y * 3 + x] = uploadedImage.data[offset] / 255;
                    assert.equal(uploadedImage.data[offset + 3], 255);
                }
            }
        },
        fillRect(x, y, width, height) {
            calls.fills++;
            assert.equal(width, 10);
            assert.equal(height, 10);
            visible[(y / 10) * 3 + x / 10] = this.fillStyle === "white" ? 1 : 0;
        },
    };
    const gridContext = {
        clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() { calls.gridStrokes++; },
    };
    const originalGlobals = Object.fromEntries(
        ["document", "requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
    );
    t.after(() => {
        for (const [key, descriptor] of Object.entries(originalGlobals)) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else delete globalThis[key];
        }
    });
    globalThis.document = { createElement: () => ({ getContext: () => imageContext }) };
    globalThis.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const renderer = createBoardRenderer(
        { getContext: () => context },
        { width: 30, height: 20, getContext: () => gridContext },
        3, 2, 10,
    );
    const board = new Uint8Array(6);
    const flush = () => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback());
    };
    return { renderer, board, visible, calls, frames, flush, context };
}

test("el dibujo completo respeta los ejes y agrupa solicitudes con el tablero más reciente", t => {
    const { renderer, board, visible, calls, frames, flush, context } = setup(t);
    renderer.renderBoard(board);
    const latest = new Uint8Array([1, 0, 1, 0, 1, 1]);
    renderer.renderBoard(latest);
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(visible, latest);
    assert.deepEqual(calls, { uploads: 1, draws: 1, fills: 0, gridStrokes: 1 });
    assert.equal(context.imageSmoothingEnabled, false);
});

test("editar pinta solo las células afectadas y combina ediciones repetidas", t => {
    const { renderer, board, visible, calls, frames, flush } = setup(t);
    renderer.renderBoard(board);
    flush();
    board[1 * 3 + 2] = 1;
    renderer.renderCell(board, 2, 1);
    renderer.renderCell(board, 2, 1);
    board[0 * 3 + 0] = 1;
    renderer.renderCell(board, 0, 0);
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(visible, board);
    assert.deepEqual(calls, { uploads: 1, draws: 1, fills: 2, gridStrokes: 1 });
    board[1 * 3 + 2] = 0;
    renderer.renderCell(board, 2, 1);
    flush();
    assert.deepEqual(visible, board);
});

test("reset o generación reemplazan ediciones pendientes sin pintar células antiguas", t => {
    const { renderer, board, visible, calls, flush } = setup(t);
    renderer.renderBoard(board);
    flush();
    board[1 * 3 + 1] = 1;
    renderer.renderCell(board, 1, 1);
    const reset = new Uint8Array(6);
    renderer.renderBoard(reset);
    flush();
    assert.deepEqual(visible, reset);
    assert.equal(calls.fills, 0);
    reset[0 * 3 + 2] = 1;
    renderer.renderBoard(reset);
    reset[1 * 3 + 0] = 1;
    renderer.renderCell(reset, 0, 1);
    flush();
    assert.deepEqual(visible, reset);
    assert.equal(calls.gridStrokes, 1);
});

test("el dibujo completo incluye ediciones ya visibles y dispose cancela cuadros pendientes", t => {
    const { renderer, board, visible, frames, calls, flush } = setup(t);
    renderer.renderBoard(board);
    flush();
    board[0 * 3 + 2] = 1;
    renderer.renderCell(board, 2, 0);
    flush();
    renderer.renderBoard(board);
    flush();
    assert.deepEqual(visible, board);
    renderer.renderBoard(board);
    renderer.dispose();
    assert.equal(frames.size, 0);
    renderer.renderBoard(board);
    assert.equal(frames.size, 0);
    assert.equal(calls.draws, 2);
});

test("el cuadro pendiente muestra la última generación aunque los buffers se reutilicen", t => {
    const { renderer, visible, frames, flush } = setup(t);
    const simulation = createSimulation(3, 2);
    simulation.board.set([0, 1, 1, 1, 0, 0]);
    renderer.renderBoard(simulation.board);
    for (let step = 0; step < 5; step++) {
        simulation.step("conway", false);
        renderer.renderBoard(simulation.board);
    }
    simulation.board[2] = 1;
    renderer.renderCell(simulation.board, 2, 0);
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(visible, simulation.board);
    simulation.reset();
    renderer.renderBoard(simulation.board);
    flush();
    assert.deepEqual(visible, new Uint8Array(6));
});
