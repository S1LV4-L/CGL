import assert from "node:assert/strict";
import { test } from "node:test";
import { createSimulation, getPresetRule } from "../src/simulation/life.ts";

test("las reglas personalizadas cubren ambos estados y todos los conteos de 0 a 8", () => {
    const simulation = createSimulation(5, 5);
    const neighbors = [[1, 1], [2, 1], [3, 1], [1, 2], [3, 2], [1, 3], [2, 3], [3, 3]];
    for (const alive of [0, 1]) {
        for (let count = 0; count <= 8; count++) {
            for (const outcome of [0, 1]) {
                simulation.reset();
                simulation.setCell(2, 2, alive);
                for (const [x, y] of neighbors.slice(0, count)) simulation.setCell(x, y, 1);
                const rules = new Uint8Array(18).fill(1 - outcome);
                rules[alive * 9 + count] = outcome;
                simulation.step(rules, false);
                assert.equal(simulation.board[12], outcome, `${alive}, ${count} vecinos, resultado ${outcome}`);
            }
        }
    }
});

test("editar una copia de un preajuste no cambia las reglas predeterminadas", () => {
    getPresetRule("conway").fill(0);
    const simulation = createSimulation(5, 5);
    seed(simulation, 5, [[1, 2], [2, 2], [3, 2]]);
    simulation.step("conway", false);
    assert.deepEqual(liveCells(simulation.board, 5), [[2, 1], [2, 2], [2, 3]]);
});

function seed(simulation, width, cells) {
    assert.equal(simulation.board.length % width, 0);
    for (const [x, y] of cells) simulation.setCell(x, y, 1);
}

function liveCells(board, width) {
    return [...board].flatMap((alive, index) => alive ? [[index % width, Math.floor(index / width)]] : []);
}

test("Conway conserva un bloque y un oscilador vuelve a su estado en dos pasos", () => {
    const simulation = createSimulation(9, 6);
    const cells = [[1, 1], [2, 1], [1, 2], [2, 2], [5, 3], [6, 3], [7, 3]];
    seed(simulation, 9, cells);
    const initial = simulation.board.slice();
    simulation.step("conway", false);
    assert.deepEqual(liveCells(simulation.board, 9), [[1, 1], [2, 1], [1, 2], [2, 2], [6, 2], [6, 3], [6, 4]]);
    simulation.step("conway", false);
    assert.deepEqual(simulation.board, initial);
});

test("los vecinos cruzan los bordes horizontal y vertical de un tablero rectangular", () => {
    const simulation = createSimulation(7, 5);
    seed(simulation, 7, [[6, 0], [0, 0], [1, 0]]);
    simulation.step("conway", false);
    assert.deepEqual(liveCells(simulation.board, 7), [[0, 0], [0, 1], [0, 4]]);
    simulation.step("conway", false);
    assert.deepEqual(liveCells(simulation.board, 7), [[0, 0], [1, 0], [6, 0]]);
});

test("Seeds: nacen células muertas con dos vecinos y ninguna célula viva sobrevive", () => {
    const simulation = createSimulation(6, 5);
    seed(simulation, 6, [[2, 2], [3, 2]]);
    simulation.step("seeds", false);
    assert.deepEqual(liveCells(simulation.board, 6), [[2, 1], [3, 1], [2, 3], [3, 3]]);
});

test("editar y borrar usan el buffer actual y detectan células que no cambiaron", () => {
    const simulation = createSimulation(7, 5);
    const first = simulation.board;
    assert.equal(simulation.setCell(6, 4, 1), true);
    assert.equal(first[4 * 7 + 6], 1);
    assert.equal(simulation.setCell(6, 4, 1), false);
    simulation.step("conway", false);
    const second = simulation.board;
    assert.equal(simulation.setCell(2, 3, 1), true);
    assert.equal(second[3 * 7 + 2], 1);
    assert.equal(first[3 * 7 + 2], 0);
    assert.equal(simulation.setCell(2, 3, 0), true);
    assert.equal(second[3 * 7 + 2], 0);
});

test("se alternan solo dos buffers y se sobrescriben los valores de generaciones antiguas", () => {
    const simulation = createSimulation(7, 5);
    const first = simulation.board;
    assert.ok(first instanceof Uint8Array);
    assert.equal(first.byteLength, 35);
    simulation.step("conway", false);
    const second = simulation.board;
    assert.notEqual(second, first);
    assert.notEqual(second.buffer, first.buffer);
    // Contaminar el destino comprueba que el paso escribe también las células muertas.
    first.fill(1);
    simulation.step("conway", false);
    assert.equal(simulation.board, first);
    assert.ok(simulation.board.every(value => value === 0));
    for (let step = 0; step < 50; step++) {
        simulation.step("conway", false);
        assert.equal(simulation.board, step % 2 === 0 ? second : first);
    }
});

test("reset vacía ambos buffers sin asignar memoria y las ediciones se usan en el paso siguiente", () => {
    const simulation = createSimulation(7, 5);
    const first = simulation.board;
    first.fill(1);
    simulation.step("conway", false);
    const second = simulation.board;
    simulation.reset();
    assert.equal(simulation.board, second);
    assert.ok(first.every(value => value === 0));
    assert.ok(second.every(value => value === 0));
    seed(simulation, 7, [[2, 2], [3, 2], [4, 2]]);
    simulation.step("conway", false);
    assert.equal(simulation.board, first);
    assert.deepEqual(liveCells(simulation.board, 7), [[3, 1], [3, 2], [3, 3]]);
    simulation.reset();
    simulation.step("seeds", false);
    assert.ok(simulation.board.every(value => value === 0));
});

test("la mutación invierte el resultado de la regla con el umbral original", () => {
    const simulation = createSimulation(7, 5);
    seed(simulation, 7, [[2, 2], [3, 2], [4, 2]]);
    const normal = createSimulation(7, 5);
    normal.board.set(simulation.board);
    normal.step("conway", false, () => { throw new Error("No se debe pedir azar sin mutación"); });
    let calls = 0;
    simulation.step("conway", true, () => { calls++; return 0; });
    assert.equal(calls, 35);
    assert.deepEqual([...simulation.board], [...normal.board].map(value => 1 - value));
    normal.reset();
    normal.step("seeds", true, () => 0.0001);
    assert.ok(normal.board.every(value => value === 0));
});

// Referencia sencilla con matrices, independiente del almacenamiento plano del motor.
function referenceStep(matrix, mode) {
    const height = matrix.length;
    const width = matrix[0].length;
    return matrix.map((row, y) => row.map((alive, x) => {
        const above = matrix[(y + height - 1) % height];
        const below = matrix[(y + 1) % height];
        const left = (x + width - 1) % width;
        const right = (x + 1) % width;
        const count = above[left] + above[x] + above[right] + row[left] + row[right]
            + below[left] + below[x] + below[right];
        if (mode instanceof Uint8Array) return mode[alive * 9 + count];
        return Number(mode === "conway" ? count === 3 || (alive && count === 2) : !alive && count === 2);
    }));
}

test("coincide con la referencia en patrones densos, tableros pequeños y cambios de regla", () => {
    for (const [width, height] of [[1, 1], [1, 7], [8, 1], [2, 2], [2, 3], [11, 7], [16, 9]]) {
        const simulation = createSimulation(width, height);
        let randomState = 42;
        let expected = Array.from({ length: height }, () => Array.from({ length: width }, () => {
            randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
            return Number(randomState / 2 ** 32 < 0.4);
        }));
        simulation.board.set(expected.flat());
        for (let generation = 0; generation < 60; generation++) {
            const mode = generation % 3 === 0 ? "seeds" : "conway";
            expected = referenceStep(expected, mode);
            simulation.step(mode, false);
            assert.deepEqual([...simulation.board], expected.flat(), `${width}×${height}, generación ${generation}`);
        }
    }
});

test("las tablas respetan las 512 configuraciones locales en Conway y Seeds", () => {
    const simulation = createSimulation(5, 5);
    for (const mode of ["conway", "seeds"]) {
        for (let pattern = 0; pattern < 512; pattern++) {
            simulation.reset();
            let neighbors = 0;
            for (let bit = 0; bit < 9; bit++) {
                const alive = (pattern >> bit) & 1;
                simulation.setCell(1 + bit % 3, 1 + Math.floor(bit / 3), alive);
                if (bit !== 4) neighbors += alive;
            }
            const alive = (pattern >> 4) & 1;
            const expected = mode === "conway"
                ? neighbors === 3 || (alive === 1 && neighbors === 2)
                : alive === 0 && neighbors === 2;
            simulation.step(mode, false);
            assert.equal(simulation.board[2 * 5 + 2], Number(expected), `${mode}, patrón ${pattern}`);
        }
    }
});

test("los bordes incorporan ediciones en las cuatro esquinas y después de reset", () => {
    const width = 7;
    const height = 5;
    const simulation = createSimulation(width, height);
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    for (const mode of ["conway", "seeds"]) {
        simulation.reset();
        for (const [x, y] of corners) {
            simulation.setCell(x, y, 1);
            const expected = referenceStep(Array.from({ length: height }, (_, row) =>
                [...simulation.board.slice(row * width, (row + 1) * width)]), mode);
            simulation.step(mode, false);
            assert.deepEqual([...simulation.board], expected.flat());
        }
        simulation.reset();
        simulation.step(mode, false);
        assert.ok(simulation.board.every(value => value === 0));
    }
});

test("reglas personalizadas y ediciones directas coinciden con la referencia en bordes estrechos", () => {
    const rules = Uint8Array.from([1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1]);
    for (const [width, height] of [[1, 1], [1, 7], [8, 1], [2, 2], [2, 7], [3, 5], [13, 8]]) {
        const simulation = createSimulation(width, height);
        for (let generation = 0; generation < 20; generation++) {
            // El motor debe leer también cambios que no pasan por setCell.
            simulation.board[(generation * 7) % simulation.board.length] ^= 1;
            const matrix = Array.from({ length: height }, (_, y) =>
                [...simulation.board.subarray(y * width, (y + 1) * width)]);
            const expected = referenceStep(matrix, rules).flat();
            simulation.step(rules, false);
            assert.deepEqual([...simulation.board], expected, `${width}×${height}, generación ${generation}`);
        }
    }
});

test("las teselas conservan patrones que cruzan sus bordes, el toro y franjas estrechas", () => {
    for (const [width, height] of [[320, 320], [321, 259], [1, 641], [641, 1], [2, 641], [641, 2], [65, 513], [64, 641]]) {
        for (const [startX, startY] of [[62, 62], [width - 2, height - 2]]) {
            const simulation = createSimulation(width, height);
            for (const [x, y] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) {
                simulation.setCell((startX + x) % width, (startY + y) % height, 1);
            }
            let expected = Array.from({ length: height }, (_, y) =>
                [...simulation.board.subarray(y * width, (y + 1) * width)]);
            for (let generation = 0; generation < 12; generation++) {
                const rules = generation < 8 ? getPresetRule("conway") : getPresetRule("seeds");
                expected = referenceStep(expected, rules);
                simulation.step(rules, false);
                assert.deepEqual([...simulation.board], expected.flat(), `${width}×${height}, ${startX}/${startY}, ${generation}`);
            }
        }
    }
});

test("omitir regiones vacías no resucita datos antiguos y detecta ediciones directas lejanas", () => {
    const width = 512, height = 512;
    const simulation = createSimulation(width, height);
    const retired = simulation.board;
    seed(simulation, width, [[10, 10], [11, 10], [10, 11], [11, 11]]);
    simulation.step("conway", false);
    retired.fill(1);
    simulation.step("conway", false);
    assert.deepEqual(liveCells(simulation.board, width), [[10, 10], [11, 10], [10, 11], [11, 11]]);
    simulation.board[400 * width + 400] = 1;
    simulation.board[400 * width + 401] = 1;
    simulation.board[401 * width + 400] = 1;
    simulation.board[401 * width + 401] = 1;
    simulation.step("conway", false);
    assert.equal(liveCells(simulation.board, width).length, 8);
    simulation.reset();
    simulation.step("conway", false);
    assert.ok(simulation.board.every(value => value === 0));
});

test("B0 y mutación cubren todo el tablero y luego pueden volver al recorrido disperso", () => {
    const width = 320, height = 320;
    const simulation = createSimulation(width, height);
    const b0 = new Uint8Array(18);
    b0[0] = 1;
    simulation.step(b0, false);
    assert.ok(simulation.board.every(value => value === 1));
    simulation.step("conway", false);
    assert.ok(simulation.board.every(value => value === 0));
    let calls = 0;
    simulation.step("conway", true, () => ++calls === width * height ? 0 : 1);
    assert.equal(calls, width * height);
    assert.deepEqual(liveCells(simulation.board, width), [[width - 1, height - 1]]);
    const surviveIsolated = new Uint8Array(18);
    surviveIsolated[9] = 1;
    simulation.step(surviveIsolated, false);
    assert.deepEqual(liveCells(simulation.board, width), [[width - 1, height - 1]]);
    simulation.step("seeds", false);
    assert.ok(simulation.board.every(value => value === 0));
});


test("wrap puede alternarse y los bordes finitos coinciden con una referencia", () => {
    for (const [width, height] of [[1, 1], [1, 7], [8, 1], [2, 3], [7, 5], [65, 67]]) {
        const simulation = createSimulation(width, height);
        for (let i = 0; i < simulation.board.length; i++) {
            simulation.board[i] = Number((i * 17 + 3) % 11 < 4);
        }
        for (let generation = 0; generation < 24; generation++) {
            const wrap = generation % 4 >= 2;
            const rules = getPresetRule(generation % 3 === 0 ? "seeds" : "conway");
            const before = simulation.board.slice();
            const expected = before.map((alive, index) => {
                const x = index % width;
                const y = Math.floor(index / width);
                let count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx, ny = y + dy;
                        if (!wrap && (nx < 0 || nx >= width || ny < 0 || ny >= height)) continue;
                        count += before[((ny + height) % height) * width + (nx + width) % width];
                    }
                }
                return rules[alive * 9 + count];
            });
            simulation.step(rules, false, Math.random, wrap);
            assert.deepEqual(simulation.board, expected, `${width}×${height}, ${generation}, wrap=${wrap}`);
        }
    }
});
