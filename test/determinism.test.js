// The property everything downstream rests on: a seed fully describes a run.
//
// The game itself still lives in index.html and needs a DOM, so these tests cover the seeded
// stream and the way the game consumes it, rather than booting the game headless. Once the
// simulation is extracted into src/sim, this file grows to hash a whole World after N ticks.
//
// The bug this is guarding against is real and already happened once: setWeather() branched
// on gameState, the night branch drew twice and the day branch once, and gameState still held
// the *previous* run's phase. Same seed, different map, depending on how the last game ended.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, createRandom } from '../src/sim/rng.js';

/** Consume draws the way generateMap does: many small, order-dependent decisions. */
function generateWorld(seed) {
    const r = createRandom(seed);
    const world = { resources: [], scenery: [], waves: [] };

    for (let i = 0; i < 260; i++) {
        const x = r.next() * 5760, y = r.next() * 3240;
        // a retry-shaped branch, so the number of draws depends on earlier draws
        if (x < 400 && y < 400) continue;
        world.scenery.push({ x: Math.round(x), y: Math.round(y), kind: r.next() > 0.5 ? 'grass' : 'pebble' });
    }
    for (let i = 0; i < 60; i++) {
        let placed = false;
        for (let attempt = 0; attempt < 20 && !placed; attempt++) {
            const x = r.range(60, 5700), y = r.range(60, 3180);
            if (world.resources.some(o => Math.hypot(o.x - x, o.y - y) < 135)) continue;
            world.resources.push({ x: Math.round(x), y: Math.round(y), type: r.next() > 0.5 ? 'wood' : 'stone' });
            placed = true;
        }
    }
    for (let w = 1; w <= 10; w++) {
        const count = w * 3 + 5;
        const side = r.int(0, 3);
        const wave = [];
        for (let i = 0; i < count; i++) {
            const roll = r.next();
            let type = 'goblin';
            if (roll > 0.35) type = 'wolf';
            if (w > 1 && roll > 0.5) type = 'orcarcher';
            if (w > 2 && roll > 0.64) type = 'goblinarcher';
            if (w > 2 && roll > 0.74) type = 'harpy';
            wave.push(type);
        }
        world.waves.push({ side, wave: wave.join(',') });
    }
    return world;
}

const hash = (w) => JSON.stringify(w);

test('one seed, one world', () => {
    assert.equal(hash(generateWorld(123456)), hash(generateWorld(123456)));
});

test('different seeds build different worlds', () => {
    assert.notEqual(hash(generateWorld(1)), hash(generateWorld(2)));
});

test('a world is stable across many repeats, not just twice', () => {
    const expected = hash(generateWorld(777));
    for (let i = 0; i < 25; i++) assert.equal(hash(generateWorld(777)), expected);
});

test('retry loops stay deterministic even though their draw count varies', () => {
    // Placement retries consume a variable number of draws. That is fine, as long as it is
    // the *same* variable number every time - which is what actually broke before.
    const a = generateWorld(4242), b = generateWorld(4242);
    assert.equal(a.resources.length, b.resources.length);
    assert.deepEqual(a.resources, b.resources);
});

test('a branch that draws a different number of times shifts everything after it', () => {
    // Demonstrates the failure mode directly, so the reason this file exists stays legible.
    function run(takeExtraDraw) {
        const r = createRandom(555);
        r.next();
        if (takeExtraDraw) r.next();          // the night branch of setWeather
        return [r.next(), r.next(), r.next()];
    }
    assert.notDeepEqual(run(false), run(true));
    assert.deepEqual(run(false), run(false));
});

test('draw order is part of the seed, so reordering calls changes the run', () => {
    const a = createRandom(9);
    const first = [a.int(0, 10), a.next()];
    const b = createRandom(9);
    const second = [b.next(), b.int(0, 10)];
    assert.notDeepEqual(first, second);
});

test('a long run does not degenerate', () => {
    // 2 million draws is well past a full game; guard against a period or bias collapse.
    const rng = mulberry32(31337);
    const buckets = new Array(8).fill(0);
    const N = 2_000_000;
    for (let i = 0; i < N; i++) buckets[Math.floor(rng() * 8)]++;
    for (const c of buckets) assert.ok(Math.abs(c / N - 0.125) < 0.005, `bucket drift: ${c / N}`);
});
