import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackedLife } from '../src/simulation/packedLife.ts';
import { HashLife, HashLifeLimit } from '../src/simulation/hashlife.ts';
import { getPresetRule } from '../src/simulation/life.ts';
test('HashLife jumps match single generations on rectangular tori, B0 and custom rules', () => {
    for (const [w, h] of [
        [1, 1],
        [2, 5],
        [7, 11],
        [16, 16],
        [33, 21],
        [65, 37],
    ])
        for (const rule of [
            getPresetRule('conway'),
            getPresetRule('seeds'),
            Uint8Array.from({ length: 18 }, (_, i) => Number(i % 3 === 0)),
        ]) {
            const expected = new PackedLife(w, h),
                actual = new PackedLife(w, h);
            let seed = 42;
            for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    if (seed / 2 ** 32 < 0.2) {
                        expected.setCell(x, y, 1);
                        actual.setCell(x, y, 1);
                    }
                }
            const hash = new HashLife(rule);
            let remaining = 13;
            while (remaining) remaining -= hash.advance(actual, remaining);
            for (let i = 0; i < 13; i++) expected.step(rule);
            assert.deepEqual(actual.words, expected.words, `${w}x${h}`);
        }
});
test('HashLife cache exhaustion never changes the original state', () => {
    const sim = new PackedLife(32, 32);
    sim.setCell(1, 1, 1);
    const original = sim.words.slice();
    assert.throws(
        () => new HashLife(getPresetRule('conway'), 3).advance(sim, 8),
        HashLifeLimit,
    );
    assert.deepEqual(sim.words, original);
});
