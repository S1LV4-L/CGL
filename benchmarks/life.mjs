import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createSimulation as createBefore } from "./life-before-point4.ts";
import { createSimulation as createAfter } from "../src/simulation/life.ts";

// Semilla fija para comparar exactamente los mismos estados y mutaciones.
function createRandom(seed) {
    let state = seed;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 2 ** 32;
    };
}

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const samples = 5;
const warmupSteps = 10;
const results = [];

for (const [width, height, steps] of [[362, 158, 30], [1024, 1024, 8]]) {
    const initial = new Uint8Array(width * height);
    const random = createRandom(42);
    for (let index = 0; index < initial.length; index++) initial[index] = Number(random() < 0.35);

    for (const [mode, mutation] of [["conway", false], ["seeds", false], ["conway", true]]) {
        const times = [[], []];
        const factories = [createBefore, createAfter];
        for (let sample = 0; sample < samples; sample++) {
            const simulations = factories.map(create => create(width, height));
            // Alternamos el orden para reducir el sesgo de ejecutar siempre uno primero.
            for (const version of sample % 2 === 0 ? [0, 1] : [1, 0]) {
                const simulation = simulations[version];
                const mutationRandom = createRandom(123);
                simulation.board.set(initial);
                for (let step = 0; step < warmupSteps; step++) simulation.step(mode, mutation, mutationRandom);
                const start = performance.now();
                for (let step = 0; step < steps; step++) simulation.step(mode, mutation, mutationRandom);
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
    samples, warmupSteps, statistic: "median ms/generation; engine only; no canvas", results,
}, null, 2));
