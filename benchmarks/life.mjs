import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createSimulation as createBefore } from "./life-before-point4.ts";
import { createSimulation as createHalo } from "./life-before-no-halo.ts";
import { createSimulation as createDirect } from "./life-before-sliding-window.ts";
import { createSimulation as createSliding } from "./life-before-tiles.ts";
import { createSimulation as createAfter, getPresetRule } from "../src/simulation/life.ts";

// npm run bench -- --no-halo: compara contra el motor anterior con copia de halo.
// --sliding-window compara contra el motor sin halo con ocho lecturas de vecinos.
// --tiles compara contra la ventana deslizante sin teselas; --sparse usa un glider.
// --no-mutation omite el caso de mutación para medir solo la selección de teselas.
// Agregar --large mide el tamaño inicial de la aplicación (12000 × 8000).
// Semilla fija para comparar exactamente los mismos estados y mutaciones.
function createRandom(seed) {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const compareHalo = process.argv.includes("--no-halo");
const compareSliding = process.argv.includes("--sliding-window");
const compareTiles = process.argv.includes("--tiles");
const sparse = process.argv.includes("--sparse");
const large = process.argv.includes("--large");
const samples = large ? 3 : 5;
const warmupSteps = large ? 2 : 10;
const results = [];
const sizes = large ? [[12000, 8000, 3]] : [[362, 158, 30], [1024, 1024, 8]];

for (const [width, height, steps] of sizes) {
    const initial = new Uint8Array(width * height);
    const random = createRandom(42);
    if (sparse) {
        const x = Math.floor(width / 2), y = Math.floor(height / 2);
        for (const [dx, dy] of [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]]) initial[(y + dy) * width + x + dx] = 1;
    } else {
        for (let index = 0; index < initial.length; index++) initial[index] = Number(random() < 0.35);
    }

    for (const [mode, mutation] of [["conway", false], ["seeds", false], ["conway", true]]) {
        if (mutation && process.argv.includes("--no-mutation")) continue;
        // La aplicación pasa una tabla editable, no el nombre del preajuste.
        const rules = compareHalo || compareSliding || compareTiles ? getPresetRule(mode) : mode;
        const times = [[], []];
        const factories = [compareTiles ? createSliding : compareSliding ? createDirect : compareHalo ? createHalo : createBefore, createAfter];
        for (let sample = 0; sample < samples; sample++) {
            const simulations = factories.map(create => create(width, height));
            // Alternamos el orden para reducir el sesgo de ejecutar siempre uno primero.
            for (const version of sample % 2 === 0 ? [0, 1] : [1, 0]) {
                const simulation = simulations[version];
                const mutationRandom = createRandom(123);
                simulation.board.set(initial);
                for (let step = 0; step < warmupSteps; step++) simulation.step(rules, mutation, mutationRandom);
                const start = performance.now();
                for (let step = 0; step < steps; step++) simulation.step(rules, mutation, mutationRandom);
                times[version].push((performance.now() - start) / steps);
            }
            // La comparación completa queda fuera del tiempo medido.
            assert.deepEqual(simulations[0].board, simulations[1].board);
        }
        const before = median(times[0]);
        const after = median(times[1]);
        results.push({
            size: `${width}x${height}`, mode, mutation, stepsPerSample: steps,
            beforeMs: Number(before.toFixed(3)), afterMs: Number(after.toFixed(3)),
            speedup: Number((before / after).toFixed(2)),
        });
    }
}

console.log(JSON.stringify({
    node: process.version, platform: process.platform, arch: process.arch,
    baseline: compareTiles ? "sliding-window" : compareSliding ? "direct-neighbors" : compareHalo ? "halo" : "before-point4",
    pattern: sparse ? "glider" : "random-35-percent",
    samples, warmupSteps, statistic: "median ms/generation; engine only; no canvas", results,
}, null, 2));
