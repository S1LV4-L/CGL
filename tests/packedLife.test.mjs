import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PackedLife, forEachMutation } from '../src/simulation/packedLife.ts';
import { getPresetRule } from '../src/simulation/life.ts';

function reference(board, w, h, rule) {
    return board.map((alive, i) => {
        const x = i % w,
            y = Math.floor(i / w);
        let count = 0;
        for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
                if (dx || dy)
                    count += board[((y + dy + h) % h) * w + ((x + dx + w) % w)];
        return rule[alive * 9 + count];
    });
}
function unpack(sim) {
    return Array.from({ length: sim.columns * sim.rows }, (_, i) =>
        sim.getCell(i % sim.columns, Math.floor(i / sim.columns)),
    );
}
test('packed CPU matches independent reference: narrow torus, partial words, dense/sparse, edits and rule changes', () => {
    for (const [w, h] of [
        [1, 1],
        [1, 65],
        [2, 3],
        [31, 37],
        [32, 32],
        [33, 65],
        [64, 96],
        [65, 97],
        [129, 70],
    ]) {
        const sim = new PackedLife(w, h);
        let seed = 42;
        const random = () =>
            (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
        let expected = Array.from({ length: w * h }, (_, i) => {
            const value = Number(random() < 0.35);
            if (value) sim.setCell(i % w, Math.floor(i / w), 1);
            return value;
        });
        for (let gen = 0; gen < 45; gen++) {
            const rule =
                gen < 15
                    ? getPresetRule('conway')
                    : gen < 25
                      ? getPresetRule('seeds')
                      : gen < 35
                        ? Uint8Array.from([
                              1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0,
                              1,
                          ])
                        : getPresetRule('conway');
            const i = Math.floor(random() * w * h);
            expected[i] ^= 1;
            sim.setCell(i % w, Math.floor(i / w), expected[i]);
            expected = reference(expected, w, h, rule);
            sim.step(rule);
            assert.deepEqual(
                unpack(sim),
                expected,
                `${w}x${h} generation ${gen}`,
            );
        }
    }
});
test('empty 12000 square does no cell work; glider initialization stays sparse; state occupies 36 MB', () => {
    const sim = new PackedLife(12000, 12000);
    assert.equal(sim.stateBytes, 36000000);
    sim.step();
    assert.equal(sim.lastActive, 0);
    for (const [x, y] of [
        [1, 0],
        [2, 1],
        [0, 2],
        [1, 2],
        [2, 2],
    ])
        sim.setCell(6000 + x, 6000 + y, 1);
    sim.step();
    assert.ok(sim.lastActive <= 9);
    assert.equal(sim.getCell(6000, 6001), 1);
});
test('geometric mutations are independent, unique and include endpoint uniforms safely', () => {
    const cells = [];
    forEachMutation(
        4,
        () => 0,
        (i) => cells.push(i),
    );
    assert.deepEqual(cells, [0, 1, 2, 3]);
    forEachMutation(
        100,
        () => 1,
        () => assert.fail('uniform 1 must terminate'),
    );
    let seed = 77,
        total = 0;
    for (let k = 0; k < 100; k++)
        forEachMutation(
            10000,
            () =>
                (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) /
                2 ** 32,
            () => total++,
        );
    assert.ok(total > 60 && total < 150, `unexpected mutation count ${total}`);
});
test('an edit on a one-cell final tile wakes both toroidal neighbours after dormancy', () => {
    for (const [w, h] of [
        [65, 65],
        [97, 97],
        [65, 97],
        [97, 65],
        [1, 97],
        [97, 1],
    ]) {
        const sim = new PackedLife(w, h),
            rule = new Uint8Array(18);
        rule[1] = 1;
        sim.step(rule);
        sim.setCell(w - 1, h - 1, 1);
        const expected = reference(unpack(sim), w, h, rule);
        sim.step(rule);
        assert.deepEqual(unpack(sim), expected, `${w}x${h}`);
    }
});
