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

// --- prediction ---------------------------------------------------------------------------
// Without it your character waits a full round trip before it moves. With it you move on the
// frame you press the key, and the server corrects you afterwards if it saw something else.
//
// The whole thing rests on one property: replaying an input must produce exactly what the
// server produced from the same input. That is why movement was split into its own method
// rather than copied into the client.

test('movement is its own method, so both ends can run the same one', () => {
    const ENT = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim', 'entities.js'), 'utf8');
    assert.ok(/    stepMovement\(dt\) \{/.test(ENT), 'there is no stepMovement to replay');
    assert.ok(/    update\(dt\) \{\r?\n        this\.stepMovement\(dt\);/.test(ENT),
        'update() no longer starts by moving, so the server and the prediction have diverged');
});

test('replaying the same inputs lands in the same place', () => {
    // This is the property reconciliation depends on. If it were false, every correction would
    // introduce its own error.
    W.resetWorld();
    W.seedRun(4242);
    W.world.base = new E.Base();

    const run = () => {
        const p = new E.Player('warrior');
        p.x = 1000; p.y = 1000;
        for (const [mx, my] of [[1, 0], [1, 0], [0.7, 0.7], [0, 1], [-1, 0], [0, 0]]) {
            p.intent.moveX = mx; p.intent.moveY = my;
            p.stepMovement(1 / 60);
        }
        return [Math.round(p.x * 1000), Math.round(p.y * 1000)];
    };
    assert.deepEqual(run(), run(), 'the same inputs produced two different positions');
    W.resetWorld();
});

test('a replay of N steps equals doing them once', () => {
    W.resetWorld();
    W.seedRun(1);
    W.world.base = new E.Base();
    const inputs = [[1, 0], [1, 0], [1, 0], [0, 1], [0, 1]];

    const straight = new E.Player('warrior');
    straight.x = 1000; straight.y = 1000;
    for (const [mx, my] of inputs) {
        straight.intent.moveX = mx; straight.intent.moveY = my;
        straight.stepMovement(1 / 60);
    }

    // the same player, rewound to the start and replayed - which is what reconcile() does
    const replayed = new E.Player('warrior');
    replayed.x = 5000; replayed.y = 5000;      // somewhere wrong
    replayed.x = 1000; replayed.y = 1000;      // ...corrected by the server
    for (const [mx, my] of inputs) {
        replayed.intent.moveX = mx; replayed.intent.moveY = my;
        replayed.stepMovement(1 / 60);
    }
    assert.equal(Math.round(replayed.x * 100), Math.round(straight.x * 100),
        'a replay did not land where the original did');
    assert.equal(Math.round(replayed.y * 100), Math.round(straight.y * 100));
    W.resetWorld();
});

test('the client predicts, reconciles, and does not ease its own player', () => {
    assert.ok(SRC.includes('predict(dt) {'), 'the client cannot predict');
    assert.ok(SRC.includes('reconcile(me, s) {'), 'the client cannot reconcile');
    assert.ok(SRC.includes('me.stepMovement(dt);'),
        'prediction does not run the simulation’s own movement');
    assert.ok(/this\.unconfirmed = this\.unconfirmed\.filter\(u => u\.seq > s\.seq\);/.test(SRC),
        'confirmed inputs are never dropped, so the queue grows forever');
    assert.ok(/w\.players\.forEach\(p => \{ if \(p\.netId !== this\.you\) ease\(p\); \}\);/.test(SRC),
        'the local player is eased as well as predicted, which fights itself');
    const INDEX = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
    assert.ok(INDEX.includes('net.predict(elapsed);'), 'the loop never predicts');
});

test('the unconfirmed queue is bounded', () => {
    // A disconnect or a stall must not leave a thousand steps to replay.
    assert.ok(/if \(this\.unconfirmed\.length > \d+\) this\.unconfirmed\.shift\(\);/.test(SRC),
        'the replay buffer has no bound');
});

// --- three bugs found by playing -----------------------------------------------------------
// None of these were reachable from the suite as it stood, because every existing test asked
// whether the world was CORRECT, and all three were about whether it could be drawn or acted on.

test('a snapshot projectile can draw itself', () => {
    // draw() calls p.draw(ctx) on every projectile. The client used to rebuild them as plain
    // objects, so the first arrow anybody fired threw TypeError inside the render loop and the
    // game stopped. It only looked like a two-player bug because a warrior is melee - it took a
    // ranged class in the match to produce a projectile at all.
    assert.ok(/Object\.create\(Projectile\.prototype\)/.test(SRC),
        'projectiles are rebuilt as plain objects and cannot draw');
    assert.ok(/Projectile\b/.test(SRC.slice(0, SRC.indexOf('const INPUT_HZ'))),
        'Projectile is not imported');
    // and the fields its draw() actually reads have to be there
    for (const f of ['vx:', 'vy:', 'color:', 'isExplosive:'])
        assert.ok(SRC.includes(f), 'a rebuilt projectile has no ' + f);
});

test('the wire carries what a projectile is drawn from', async () => {
    const P = await import('../src/net/protocol.js');
    const players = [{ id: 'a', cls: 'warrior', x: 0, y: 0, hp: 1, maxHp: 1, mp: 0, maxMp: 1, level: 1, angle: 0, seq: 0 }];
    const snap = {
        t: 'snap', tick: 1, phase: 'DAY', wave: 1, phaseTimer: 1, weather: 'clear', modifier: 'none',
        inventory: { wood: 0, stone: 0, mana: 0 }, base: { x: 0, y: 0, hp: 1, maxHp: 1 },
        players, enemies: [], critters: [], items: [], effects: [],
        projectiles: [{ id: 5, x: 100, y: 200, vx: 0, vy: 1, r: 0x4d, g: 0xff, b: 0x4d, explosive: false }],
        events: []
    };
    const slots = new Map([['a', 0]]);
    const roster = new Map([[0, { slot: 0, id: 'a', cls: 'warrior' }]]);
    const { buffer } = P.encodeSnapshot(snap, slots, null);
    const { snap: back } = P.decodeSnapshot(buffer, roster, null);
    const p = back.projectiles[0];
    assert.equal(p.x, 100);
    assert.ok(Math.abs(p.vy - 1) < 0.05 && Math.abs(p.vx) < 0.05, 'the heading was lost');
    assert.equal(p.color, '#4dff4d', 'the colour was lost, so an arrow draws as a bolt');
    assert.equal(p.explosive, false);
});

test('an online match sets the same class chrome a local one does', () => {
    const INDEX = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
    assert.ok(/function applyClassChrome\(cls\) \{/.test(INDEX),
        'the class chrome is still buried inside startGame');
    // both entry points must call it, or one of them shows a placeholder glyph
    const calls = (INDEX.match(/applyClassChrome\(/g) || []).length;
    assert.ok(calls >= 3, 'applyClassChrome is called ' + calls + ' times; expected define + both modes');
    assert.ok(/applyClassChrome\(selectedClass\);/.test(INDEX), 'startGame does not set the chrome');
    assert.ok(/applyClassChrome\(cls\);/.test(INDEX), 'joinMatch does not set the chrome');

    // and it must do it AFTER the HUD is on screen. setSkillIcon measures the slot it is
    // filling, and a display:none element measures zero - the icons then get cropped for the
    // 68px fallback while the Shift slot is really 108px wide, which is what put a slice of the
    // neighbouring card next to the dash. Ordering rather than logic, so order is what is checked.
    const joinFn = INDEX.slice(INDEX.indexOf('async function joinMatch('));
    const unhide = joinFn.indexOf("getElementById('hud').classList.remove('hidden')");
    const chrome = joinFn.indexOf('applyClassChrome(cls);');
    assert.ok(unhide > 0 && chrome > unhide,
        'joinMatch sets the class chrome before the HUD is visible, so every icon is measured '
        + 'against a zero-sized box');
});

test('one keypress becomes exactly one packet', () => {
    // readLocalIntent runs once a frame from the loop and again per send from the network
    // client. Assigning the edge meant whichever ran first ate the keypress, so most abilities
    // never left the browser.
    const INDEX = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
    assert.ok(/if \(edge\('e'\)\) i\.ability = true;/.test(INDEX), 'the ability edge is not latched');
    assert.ok(/i\.ability = i\.overcharge = i\.interact = false;/.test(INDEX),
        'the sender never clears the latch, so one press would fire forever');
    // and the sender must not re-read the keyboard, or it clears the latch before reading it
    const sender = INDEX.slice(INDEX.indexOf('client.startSendingInput('));
    assert.ok(!/readLocalIntent\(player\);/.test(sender.slice(0, 500)),
        'the input sender reads the keyboard again and eats the keypress');
});
