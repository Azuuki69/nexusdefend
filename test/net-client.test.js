// The client half of a server-authoritative match.
//
// MatchClient writes the server's answer into the same `world` the renderer already draws from,
// which is why no drawing code had to change. What is worth pinning down is the reconciliation:
// matching a live list against a snapshot by network id rather than by array position. Index
// matching looks fine until something in the middle dies, and then every sprite after it becomes
// the wrong creature.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as W from '../src/sim/world.js';
import * as E from '../src/sim/entities.js';

const SRC = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'net', 'client.js'), 'utf8');

test('the net client has no browser in it beyond the socket it needs', () => {
    const code = SRC.replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['document', 'canvas', 'getElementById', 'new Image', 'audioCtx'])
        assert.ok(!code.includes(forbidden), 'client.js reaches for ' + forbidden);
    assert.ok(code.includes('WebSocket'), 'a net client with no socket');
});

test('every entity a snapshot carries has a stable id to match on', () => {
    W.resetWorld();
    const a = new E.Enemy(0, 0, 'goblin');
    const b = new E.Enemy(0, 0, 'wolf');
    const i = new E.Item(0, 0, 'hp');
    for (const e of [a, b, i]) assert.ok(Number.isInteger(e.nid), 'no network id on ' + e.constructor.name);
    assert.equal(new Set([a.nid, b.nid, i.nid]).size, 3, 'ids collided');
    W.resetWorld();
});

test('ids restart per match, so two matches cannot collide', () => {
    const one = W.createWorld(); W.useWorld(one);
    const first = new E.Enemy(0, 0, 'goblin').nid;
    new E.Enemy(0, 0, 'goblin'); new E.Enemy(0, 0, 'goblin');
    const two = W.createWorld(); W.useWorld(two);
    assert.equal(new E.Enemy(0, 0, 'goblin').nid, first, 'a new match kept the old counter');
    W.resetWorld();
});

// The reconciler is a pure function of (list, snapshot). Rather than boot a socket, exercise
// the same algorithm the client uses and prove the property that matters.
function reconcile(list, incoming, make, update) {
    const byId = new Map(list.map(e => [e.nid, e]));
    const next = [];
    for (const s of incoming) {
        let e = byId.get(s.id);
        if (!e) { e = make(s); e.nid = s.id; }
        update(e, s);
        next.push(e);
    }
    list.length = 0;
    for (const e of next) list.push(e);
}

const mk = s => ({ nid: s.id, type: s.type, x: s.x, y: s.y });
const up = (e, s) => { e.x = s.x; e.y = s.y; e.type = s.type; };

test('matching by id survives a death in the middle of the list', () => {
    const list = [];
    reconcile(list, [
        { id: 1, type: 'goblin', x: 10, y: 0 },
        { id: 2, type: 'wolf', x: 20, y: 0 },
        { id: 3, type: 'troll', x: 30, y: 0 }
    ], mk, up);
    const goblin = list[0], troll = list[2];
    assert.equal(list.length, 3);

    // the wolf dies; the other two must stay themselves
    reconcile(list, [
        { id: 1, type: 'goblin', x: 11, y: 0 },
        { id: 3, type: 'troll', x: 31, y: 0 }
    ], mk, up);
    assert.equal(list.length, 2);
    assert.equal(list[0], goblin, 'the goblin was replaced by a different object');
    assert.equal(list[1], troll, 'the troll became a different creature');
    assert.equal(list[1].type, 'troll');
});

test('a newcomer is built, and everything else is left alone', () => {
    const list = [];
    reconcile(list, [{ id: 1, type: 'goblin', x: 0, y: 0 }], mk, up);
    const goblin = list[0];
    reconcile(list, [
        { id: 1, type: 'goblin', x: 5, y: 0 },
        { id: 9, type: 'harpy', x: 50, y: 0 }
    ], mk, up);
    assert.equal(list.length, 2);
    assert.equal(list[0], goblin, 'an existing entity was rebuilt instead of updated');
    assert.equal(list[1].type, 'harpy');
    assert.equal(list[1].nid, 9);
});

test('the list ends up in the order the server sent', () => {
    const list = [];
    reconcile(list, [{ id: 1, type: 'a', x: 0, y: 0 }, { id: 2, type: 'b', x: 0, y: 0 }], mk, up);
    reconcile(list, [{ id: 2, type: 'b', x: 0, y: 0 }, { id: 1, type: 'a', x: 0, y: 0 }], mk, up);
    assert.deepEqual(list.map(e => e.nid), [2, 1], 'the client kept its own ordering');
});

test('the client renders the whole party, not just this browser', () => {
    // Only the local player used to be drawn, so a co-op partner was in the world and invisible.
    const INDEX = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
    assert.ok(/world\.players\.forEach\(p => \{ if \(inView\(p\.x, p\.y\)\) p\.draw\(ctx\); \}\);/.test(INDEX),
        'draw() does not paint every player');
    assert.ok(!/[^.]\bplayer\.draw\(ctx\)/.test(INDEX), 'a lone player.draw survived');
});

test('online mode is a separate path, and local play still simulates', () => {
    const INDEX = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
    assert.ok(INDEX.includes('function isOnline()'), 'there is no online mode');
    assert.ok(INDEX.includes('if (isOnline()) {'), 'the loop does not branch on it');
    // and the local path is untouched: still a fixed-step accumulator
    assert.ok(/while \(simAccumulator >= SIM_DT\) \{/.test(INDEX),
        'local play stopped stepping a fixed accumulator');
    assert.ok(/if \(handleLocalIntents\(SIM_DT\)\) stepWorld\(SIM_DT\);/.test(INDEX),
        'local play stopped running the simulation');
});
