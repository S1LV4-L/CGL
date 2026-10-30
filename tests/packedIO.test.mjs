import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackedLife, resizePacked } from '../src/simulation/packedLife.ts';
import { getPresetRule } from '../src/simulation/life.ts';
import {
    checkpoint,
    exportRleChunks,
    inspectRle,
    readCheckpoint,
    readRleFile,
} from '../src/simulation/rleStream.ts';
import {
    OccupancyPyramid,
    rasterize,
} from '../src/rendering/packedRenderer.ts';

test('word-span import and centred resize preserve every cell for arbitrary word offsets', () => {
    for (const [w, h, nw, nh] of [
        [1, 1, 33, 7],
        [31, 11, 64, 19],
        [65, 9, 32, 5],
        [97, 7, 33, 11],
        [32, 5, 65, 9],
    ]) {
        const sim = new PackedLife(w, h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x += 7) sim.setRun(x, y, 3);
        const next = resizePacked(sim, nw, nh),
            cw = Math.min(w, nw),
            ch = Math.min(h, nh);
        for (let y = 0; y < nh; y++)
            for (let x = 0; x < nw; x++) {
                const rx = x - Math.floor((nw - cw) / 2),
                    ry = y - Math.floor((nh - ch) / 2);
                const expected =
                    rx < 0 || ry < 0 || rx >= cw || ry >= ch
                        ? 0
                        : sim.getCell(
                              rx + Math.floor((w - cw) / 2),
                              ry + Math.floor((h - ch) / 2),
                          );
                assert.equal(
                    next.getCell(x, y),
                    expected,
                    `${w}->${nw}: ${x},${y}`,
                );
            }
    }
});
test('bounded RLE chunks and binary checkpoints round trip cells, rules and generation', async () => {
    const sim = new PackedLife(513, 259),
        rule = getPresetRule('seeds');
    for (let y = 0; y < sim.rows; y++)
        for (let x = 0; x < sim.columns; x += 2) sim.setCell(x, y, 1);
    const chunks = [...exportRleChunks(sim, rule)];
    assert.ok(chunks.every((s) => s.length < 66000));
    const text = chunks.join('');
    assert.ok(
        text
            .split('\n')
            .slice(1)
            .every((line) => line.length <= 70),
    );
    const parsed = inspectRle(text, sim.columns, sim.rows),
        loaded = new PackedLife(sim.columns, sim.rows);
    parsed.visit((x, y, n) => loaded.setRun(x, y, n));
    assert.deepEqual(loaded.words, sim.words);
    assert.deepEqual(parsed.rule, rule);
    const file = checkpoint(sim, rule, 123456),
        saved = await readCheckpoint(file);
    assert.equal(saved.generation, 123456);
    assert.deepEqual(saved.words, sim.words);
    assert.deepEqual(saved.rule, rule);
    await assert.rejects(readCheckpoint(new Blob([new Uint8Array(4)])));
    const corrupt = new Uint8Array(await file.arrayBuffer());
    corrupt[48 + corrupt.length - 49] |= 128;
    await assert.rejects(readCheckpoint(new Blob([corrupt])), /relleno/);
});
test('RLE validates all tokens before a caller can replace its previous state', () => {
    for (const text of [
        'x=3,y=3\n3o$4o!',
        'x=1,y=1\no!o',
        'x=1,y=1\n0o!',
        'x=1,y=1\no',
    ])
        assert.throws(() => inspectRle(text, 12000, 12000));
});
test('streamed RLE handles chunk boundaries, comments, BOM, split counts and strict validation', async () => {
    const original = '\ufeff#N glider\r\nx=3,y=3,rule=B3/S23\r\nbo$2bo$3o!\n';
    const chunks = [...original].map((c) => new TextEncoder().encode(c));
    const file = {
        size: new TextEncoder().encode(original).length,
        stream() {
            return new ReadableStream({
                start(controller) {
                    for (const c of chunks) controller.enqueue(c);
                    controller.close();
                },
            });
        },
    };
    const runs = [];
    const meta = await readRleFile(file, 12000, 12000, (...args) =>
        runs.push(args),
    );
    assert.equal(meta.width, 3);
    assert.deepEqual(runs, [
        [1, 0, 1],
        [2, 1, 1],
        [0, 2, 3],
    ]);
    for (const text of [
        'x=1,y=1\no!o',
        'x=1,y=1\n2o!',
        'x=1,y=1\n0o!',
        'x=1,y=1\no',
    ])
        await assert.rejects(readRleFile(new Blob([text]), 100, 100));
});
test('zoom summaries preserve isolated cells and clear stale pixels after edits, steps and reset', () => {
    const sim = new PackedLife(12000, 12000),
        pyramid = new OccupancyPyramid(12000, 12000);
    const pixels = new Uint32Array(256 * 256),
        camera = { x: 6000, y: 6000, scale: 256 / 12000 };
    sim.setCell(6000, 6000, 1);
    rasterize(sim, pyramid, camera, 256, 256, pixels);
    assert.ok(pixels.some((p) => p === 0xffffffff));
    sim.step();
    rasterize(sim, pyramid, camera, 256, 256, pixels);
    assert.ok(!pixels.some((p) => p === 0xffffffff));
    sim.setRun(11980, 11999, 20);
    rasterize(sim, pyramid, camera, 256, 256, pixels);
    assert.ok(pixels.some((p) => p === 0xffffffff));
    sim.reset();
    rasterize(sim, pyramid, camera, 256, 256, pixels);
    assert.ok(!pixels.some((p) => p === 0xffffffff));
});
