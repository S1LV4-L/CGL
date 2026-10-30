import assert from 'node:assert/strict';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import { createSimulation, getPresetRule } from '../src/simulation/life.ts';
import { PackedLife } from '../src/simulation/packedLife.ts';
import { HashLife } from '../src/simulation/hashlife.ts';
import {
    OccupancyPyramid,
    rasterize,
} from '../src/rendering/packedRenderer.ts';

const size = process.argv.includes('--large') ? 12000 : 1024,
    rule = getPresetRule('conway');
const median = (a) => [...a].sort((a, b) => a - b)[Math.floor(a.length / 2)];
const results = [];
for (const pattern of ['glider', 'random-35-percent']) {
    const initial = new Uint8Array(size * size);
    let seed = 42;
    if (pattern === 'glider')
        for (const [x, y] of [
            [1, 0],
            [2, 1],
            [0, 2],
            [1, 2],
            [2, 2],
        ])
            initial[
                (Math.floor(size / 2) + y) * size + Math.floor(size / 2) + x
            ] = 1;
    else
        for (let i = 0; i < initial.length; i++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            initial[i] = Number(seed / 2 ** 32 < 0.35);
        }
    const cases = [];
    for (const packed of [false, true]) {
        const first = [],
            warm = [];
        let final;
        for (let sample = 0; sample < 3; sample++) {
            global.gc?.();
            const sim = packed
                ? new PackedLife(size, size)
                : createSimulation(size, size);
            if (packed) {
                for (let i = 0; i < initial.length; i++)
                    if (initial[i])
                        sim.words[
                            Math.floor(i / size) * sim.stride +
                                ((i % size) >>> 5)
                        ] |= 1 << (i % 32);
                sim.activateOccupied();
            } else sim.board.set(initial);
            const step = () =>
                packed ? sim.step(rule) : sim.step(rule, false);
            let start = performance.now();
            step();
            first.push(performance.now() - start);
            for (let i = 0; i < 3; i++) step();
            start = performance.now();
            for (let i = 0; i < 5; i++) step();
            warm.push((performance.now() - start) / 5);
            if (sample === 2)
                final = packed ? sim.words.slice() : sim.board.slice();
        }
        cases.push({
            engine: packed ? 'packed CPU' : 'byte CPU',
            firstMs: median(first),
            generationMs: median(warm),
        });
        if (packed) {
            for (let i = 0; i < initial.length; i++)
                assert.equal(
                    (final[
                        Math.floor(i / size) * Math.ceil(size / 32) +
                            ((i % size) >>> 5)
                    ] >>>
                        (i % 32)) &
                        1,
                    cases[0].final[i],
                );
        } else cases[0].final = final;
    }
    delete cases[0].final;
    results.push({ pattern, cases });
}
const sparse = new PackedLife(size, size);
for (const [x, y] of [
    [1, 0],
    [2, 1],
    [0, 2],
    [1, 2],
    [2, 2],
])
    sparse.setCell(x, y, 1);
const hash = new HashLife(rule);
let start = performance.now(),
    remaining = 1024;
while (remaining) remaining -= hash.advance(sparse, remaining);
const hashMs = performance.now() - start;
const pyramid = new OccupancyPyramid(size, size),
    pixels = new Uint32Array(1024 * 768),
    view = {
        x: size / 2,
        y: size / 2,
        scale: Math.min(1024 / size, 768 / size),
    };
start = performance.now();
rasterize(sparse, pyramid, view, 1024, 768, pixels);
const overviewMs = performance.now() - start;
console.log(
    JSON.stringify(
        {
            node: process.version,
            cpu: os.cpus()[0].model,
            size,
            samples: 3,
            measuredGenerations: '5-9',
            mutation: false,
            statistic: 'median ms/generation; engine only',
            results,
            hash1024Ms: hashMs,
            overviewMs,
            stateBytes: sparse.stateBytes,
        },
        null,
        2,
    ),
);
