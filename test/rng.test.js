import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, createRandom, randomSeed } from '../src/sim/rng.js';

test('same seed replays the same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 500 }, a);
    const second = Array.from({ length: 500 }, b);
    assert.deepEqual(first, second);
});

test('different seeds diverge', () => {
    const a = Array.from({ length: 100 }, mulberry32(1));
    const b = Array.from({ length: 100 }, mulberry32(2));
    assert.notDeepEqual(a, b);
});

test('output stays in [0, 1)', () => {
    const rng = mulberry32(99);
    for (let i = 0; i < 100000; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    }
});

test('distribution is not obviously skewed', () => {
    // Ten buckets over 100k draws. A fair generator lands near 10% each; this is a smoke
    // test for a broken generator, not a statistical proof.
    const rng = mulberry32(7);
    const buckets = new Array(10).fill(0);
    const N = 100000;
    for (let i = 0; i < N; i++) buckets[Math.floor(rng() * 10)]++;
    for (const count of buckets) {
        const share = count / N;
        assert.ok(share > 0.085 && share < 0.115, `bucket share ${share}`);
    }
});

test('survives a full 32-bit seed without losing determinism', () => {
    const seed = 0xFFFFFFFF;
    assert.deepEqual(
        Array.from({ length: 50 }, mulberry32(seed)),
        Array.from({ length: 50 }, mulberry32(seed))
    );
});

test('helpers respect their bounds', () => {
    const r = createRandom(42);
    for (let i = 0; i < 20000; i++) {
        const f = r.range(-5, 5);
        assert.ok(f >= -5 && f < 5, `range: ${f}`);

        const n = r.int(1, 6);
        assert.ok(Number.isInteger(n) && n >= 1 && n <= 6, `int: ${n}`);

        const ang = r.angle();
        assert.ok(ang >= 0 && ang < Math.PI * 2, `angle: ${ang}`);

        assert.ok(Math.abs(r.sign()) === 1);
    }
});

test('int() reaches both ends of its range', () => {
    // An off-by-one here would silently make one outcome unreachable - which is exactly the
    // kind of bug that hides in a wave table for weeks.
    const r = createRandom(3);
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(r.int(0, 3));
    assert.deepEqual([...seen].sort(), [0, 1, 2, 3]);
});

test('pick returns a member, and undefined for nothing', () => {
    const r = createRandom(8);
    const list = ['goblin', 'wolf', 'harpy'];
    for (let i = 0; i < 500; i++) assert.ok(list.includes(r.pick(list)));
    assert.equal(r.pick([]), undefined);
});

test('chance(0) never fires and chance(1) always does', () => {
    const r = createRandom(11);
    for (let i = 0; i < 1000; i++) {
        assert.equal(r.chance(0), false);
        assert.equal(r.chance(1), true);
    }
});

test('two streams on one seed stay in lockstep', () => {
    // This is the property the server and a replay depend on: identical calls in identical
    // order produce identical results.
    const a = createRandom(2024);
    const b = createRandom(2024);
    for (let i = 0; i < 1000; i++) {
        assert.equal(a.next(), b.next());
        assert.equal(a.int(0, 100), b.int(0, 100));
        assert.equal(a.chance(0.3), b.chance(0.3));
    }
});

test('randomSeed produces a usable 32-bit integer', () => {
    for (let i = 0; i < 1000; i++) {
        const s = randomSeed();
        assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xFFFFFFFF, `seed: ${s}`);
    }
});
