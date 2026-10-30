import assert from "node:assert/strict";
import { test } from "node:test";
import { fitCamera, screenToCell, zoomAt, MAX_SCALE, MIN_SCALE } from "../src/rendering/camera.ts";
import { resizeSimulation, validBoardSize } from "../src/simulation/resize.ts";

test("el zoom mantiene la célula bajo el puntero y respeta sus límites", () => {
    const camera = { x: 140, y: 80, scale: 5 };
    const view = { width: 800, height: 500 };
    const anchor = screenToCell(123, 201, camera, view);
    for (const factor of [1.5, 0.01, 1000]) {
        const zoomed = zoomAt(camera, view, 123, 201, factor);
        const result = screenToCell(123, 201, zoomed, view);
        assert.ok(Math.abs(result.x - anchor.x) < 1e-9);
        assert.ok(Math.abs(result.y - anchor.y) < 1e-9);
        assert.ok(zoomed.scale >= MIN_SCALE && zoomed.scale <= MAX_SCALE);
    }
});

test("ver todo centra y encaja tableros pequeños, rectangulares y grandes", () => {
    const view = { width: 900, height: 600 };
    for (const [columns, rows] of [[1, 1], [30, 100], [12000, 8000]]) {
        const camera = fitCamera(columns, rows, view);
        assert.equal(camera.x, columns / 2);
        assert.equal(camera.y, rows / 2);
        assert.ok(columns * camera.scale <= view.width - 24);
        assert.ok(rows * camera.scale <= view.height - 24);
    }
});

test("redimensionar conserva el patrón centrado, recorta bordes y permite evolucionar", () => {
    const initial = new Uint8Array(5 * 5);
    initial[0] = 1;
    initial[11] = initial[12] = initial[13] = 1;
    const expanded = resizeSimulation(initial, 5, 5, 9, 7);
    assert.equal(expanded.board[1 * 9 + 2], 1);
    assert.equal(expanded.board[3 * 9 + 4], 1);
    const cropped = resizeSimulation(expanded.board, 9, 7, 3, 3);
    assert.deepEqual([...cropped.board], [0, 0, 0, 1, 1, 1, 0, 0, 0]);
    cropped.step("conway", false);
    assert.equal(cropped.board.length, 9);
    assert.equal(initial[0], 1);
});

test("valida dimensiones enteras positivas y limita la memoria total", () => {
    assert.ok(validBoardSize(12000, 8000));
    assert.ok(validBoardSize(12000, 12000));
    assert.ok(validBoardSize(1, 1));
    for (const [columns, rows] of [[0, 2], [-1, 2], [2.5, 4], [NaN, 4], [12700, 1], [12699, 12699]]) {
        assert.equal(validBoardSize(columns, rows), false);
    }
});
