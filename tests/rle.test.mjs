import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_RLE_FILE_SIZE, parseRle, serializeRle } from "../src/simulation/rle.ts";
import { createSimulation } from "../src/simulation/life.ts";

test("carga un glider con comentarios, BOM, CRLF y cabecera sin regla", () => {
    const result = parseRle("\uFEFF#N Glider\r\n#C Ejemplo\r\nx=3,y=3\r\nbo$2bo$3o!\r\n", 8, 6);
    assert.equal(result.mode, "conway");
    assert.equal(result.width, 3);
    assert.equal(result.height, 3);
    assert.deepEqual([...result.board].flatMap((value, i) => value ? [[i % 8, Math.floor(i / 8)]] : []),
        [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]);
});

test("reconoce reglas compatibles y saltos de varias filas", () => {
    for (const [rule, mode] of [["B3/S23", "conway"], ["23/3", "conway"], ["S23/B3", "conway"],
        ["B2/S", "seeds"], ["/2", "seeds"], ["S/B2", "seeds"]]) {
        const result = parseRle(`x = 4, y = 5, rule = ${rule}\n2$2bo$2o!`, 4, 5);
        assert.equal(result.mode, mode);
        assert.equal(result.board[2 * 4 + 2], 1);
        assert.equal(result.board[3 * 4], 1);
        assert.equal(result.board[3 * 4 + 1], 1);
    }
});

test("rechaza archivos inválidos, reglas ajenas y patrones demasiado grandes", () => {
    for (const text of ["", "bo$2bo$3o!", "x=101,y=1\n!", "x=1,y=101\n!",
        "x=1,y=1,rule=B36/S23\no!", "x=1,y=1\n2o!", "x=1,y=1\n2b!",
        "x=1,y=1\n$o!", "x=1,y=1\n2$!", "x=1,y=1\n0o!", "x=1,y=1\no",
        "x=1,y=1\nx!", "x=1,y=1\no2!", "x=1,y=1\no!o",
        "x=1,y=1\n999999999999999999999o!", "x=0,y=0\no!"]) {
        assert.throws(() => parseRle(text, 100, 100), Error, text);
    }
    assert.throws(() => parseRle("#".repeat(MAX_RLE_FILE_SIZE + 1), 100, 100), /1 MB/);
});

test("exporta RLE conocido sin desplazar el patrón y omite ceros finales", () => {
    const board = new Uint8Array(8 * 6);
    board[2 * 8 + 3] = 1;
    board[2 * 8 + 4] = 1;
    board[4 * 8 + 1] = 1;
    assert.equal(serializeRle(board, 8, 6, "seeds"), "x = 8, y = 6, rule = B2/S\n2$3b2o2$bo!\n");
});

test("exportar y cargar conserva todas las células, dimensiones y regla", () => {
    for (const [columns, rows] of [[1, 1], [9, 6], [100, 100]]) {
        for (const mode of ["conway", "seeds"]) {
            const patterns = [new Uint8Array(columns * rows), new Uint8Array(columns * rows).fill(1),
                Uint8Array.from({ length: columns * rows }, (_, i) => Number(i % 2 === 0 || i % 17 === 0))];
            for (const board of patterns) {
                const text = serializeRle(board, columns, rows, mode);
                assert.ok(text.trim().split("\n").slice(1).every(line => line.length <= 70));
                const loaded = parseRle(text, columns, rows);
                assert.deepEqual(loaded.board, board);
                assert.equal(loaded.mode, mode);
                assert.equal(loaded.width, columns);
                assert.equal(loaded.height, rows);
            }
        }
    }
    assert.equal(parseRle("x=0,y=0\n!", 100, 100).board.some(Boolean), false);
});

test("el patrón cargado reemplaza ambos buffers y evoluciona con el motor", () => {
    const simulation = createSimulation(8, 6);
    simulation.board.fill(1);
    simulation.step("seeds", false);
    const pattern = parseRle("x=5,y=3,rule=B3/S23\n$booo!", 8, 6);
    simulation.reset();
    simulation.board.set(pattern.board);
    simulation.step(pattern.mode, false);
    const expected = new Uint8Array(8 * 6);
    for (const y of [0, 1, 2]) expected[y * 8 + 2] = 1;
    assert.deepEqual(simulation.board, expected);
});
