// End-to-end against a running `wrangler dev` on :8787.
//
// Skipped automatically when the dev server is not up, so `npm test` stays green without it.
// Start it with:  npx wrangler dev --port 8787 --local

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

import { MSG, decodeSnapshot, decodeRoster } from '../src/net/protocol.js';

const BASE = 'http://127.0.0.1:8787';
const WS = 'ws://127.0.0.1:8787';

// Probed at module load with top-level await, so `skip` receives a real boolean. Passing a
// function here silently skips everything, because a function is truthy.
// Retried: wrangler reloads whenever a watched file changes, and a reload can hold a request
// for a couple of seconds. A single 2s probe called the server down while it was merely busy,
// and silently skipped thirteen tests.
let up = false;
for (let attempt = 0; attempt < 4 && !up; attempt++) {
    try {
        up = (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) })).ok;
    } catch { up = false; }
    if (!up) await new Promise(r => setTimeout(r, 500));
}
if (!up) console.log('  (wrangler dev not on :8787 - skipping match room tests)');
const skip = up ? false : 'wrangler dev not running';

// Durable Objects outlive a test run - the same match id resolves to the same object, still
// ticking from last time. Namespacing per run gives every test a world that starts at tick 0.
const RUN = Math.random().toString(36).slice(2, 8);
const room = (name) => `${name}-${RUN}`;

const open = new Set();
after(() => { for (const ws of open) { try { ws.close(); } catch {} } open.clear(); });

/** Connect, collect messages, and resolve once `want(msgs)` is satisfied or time runs out. */
function connect(matchId, playerId, extra = '') {
    const ws = new WebSocket(`${WS}/ws/match/${matchId}?player=${playerId}${extra}`);
    ws.binaryType = 'arraybuffer';
    open.add(ws);
    const msgs = [];
    // Welcome and map are text and arrive once. Snapshots and the roster are binary and arrive
    // constantly - decoded here so the tests above can go on reading plain objects.
    let roster = new Map();
    let header = null;
    ws.addEventListener('message', (e) => {
        if (!(e.data instanceof ArrayBuffer)) { msgs.push(JSON.parse(e.data)); return; }
        const kind = new DataView(e.data).getUint8(0);
        if (kind === MSG.ROSTER) {
            const r = decodeRoster(e.data);
            roster = new Map(r.players.map(p => [p.slot, p]));
            msgs.push(r);
            return;
        }
        const out = decodeSnapshot(e.data, roster, header);
        if (!out) return;                 // a snapshot before the first header; the client drops these too
        header = out.header;
        msgs.push(out.snap);
    });
    const ready = new Promise((res, rej) => {
        ws.addEventListener('open', res);
        ws.addEventListener('error', rej);
    });
    return {
        ws, msgs, ready,
        send: (o) => ws.send(JSON.stringify(o)),
        close: () => { open.delete(ws); try { ws.close(); } catch {} },
        async until(pred, ms = 4000) {
            const deadline = Date.now() + ms;
            while (Date.now() < deadline) {
                const hit = pred(msgs);
                if (hit) return hit;
                await new Promise(r => setTimeout(r, 25));
            }
            throw new Error(`timed out; last message: ${JSON.stringify(msgs.at(-1))}`);
        }
    };
}

describe('MatchRoom', () => {
    test('the worker is reachable', { skip }, async () => {
        const r = await fetch(`${BASE}/health`);
        assert.equal((await r.json()).ok, true);
    });

    test('a client is welcomed and then fed snapshots on the server clock', { skip }, async () => {
        const c = connect(room('t-solo'), 'p1');
        await c.ready;
        const welcome = await c.until(m => m.find(x => x.t === 'welcome'));
        assert.equal(welcome.hz, 20);
        assert.ok(Number.isInteger(welcome.seed));

        // ticks should arrive without the client ever asking
        const snaps = await c.until(m => m.filter(x => x.t === 'snap').length >= 10 && m.filter(x => x.t === 'snap'));
        const ticks = snaps.map(s => s.tick);
        assert.deepEqual(ticks, ticks.slice().sort((a, b) => a - b), 'ticks must be monotonic');
        assert.ok(ticks.at(-1) - ticks[0] >= 9, 'server advanced its own tick');
        c.close();
    });

    test('two clients in one match see the same world at the same tick', { skip }, async () => {
        const a = connect(room('t-shared'), 'pa');
        const b = connect(room('t-shared'), 'pb');
        await Promise.all([a.ready, b.ready]);

        await a.until(m => m.filter(x => x.t === 'snap').length >= 15);
        await b.until(m => m.filter(x => x.t === 'snap').length >= 15);

        const byTick = (c) => new Map(c.msgs.filter(x => x.t === 'snap').map(s => [s.tick, s]));
        const ta = byTick(a), tb = byTick(b);
        const shared = [...ta.keys()].filter(k => tb.has(k));
        assert.ok(shared.length >= 5, `expected overlapping ticks, got ${shared.length}`);

        for (const tick of shared) {
            assert.deepEqual(ta.get(tick).enemies, tb.get(tick).enemies,
                `enemies disagree at tick ${tick}`);
        }

        // and both see both players
        const last = ta.get(shared.at(-1));
        assert.deepEqual([...last.players.map(p => p.id)].sort(), ['pa', 'pb']);
        a.close(); b.close();
    });

    test('the server moves you - the client only sends intent', { skip }, async () => {
        const c = connect(room('t-input'), 'pm');
        await c.ready;
        await c.until(m => m.find(x => x.t === 'snap'));

        const startX = c.msgs.filter(x => x.t === 'snap').at(-1).players.find(p => p.id === 'pm').x;
        for (let i = 0; i < 20; i++) { c.send({ t: 'input', moveX: 1, moveY: 0, seq: i }); await new Promise(r => setTimeout(r, 25)); }

        const moved = await c.until(m => {
            const p = m.filter(x => x.t === 'snap').at(-1)?.players.find(p => p.id === 'pm');
            return p && p.x > startX + 30 ? p : null;
        });
        assert.ok(moved.x > startX, 'server applied the movement intent');
        assert.ok(moved.seq > 0, 'server echoed the input sequence for reconciliation');
        c.close();
    });

    test('a client cannot teleport itself', { skip }, async () => {
        const c = connect(room('t-cheat'), 'pc');
        await c.ready;
        await c.until(m => m.find(x => x.t === 'snap'));

        // claim a position, an absurd speed, and a non-finite vector
        c.send({ t: 'input', x: 999999, y: 999999, moveX: 5000, moveY: 5000, seq: 1 });
        c.send({ t: 'input', moveX: Infinity, moveY: NaN, seq: 2 });
        await new Promise(r => setTimeout(r, 400));

        const p = c.msgs.filter(x => x.t === 'snap').at(-1).players.find(p => p.id === 'pc');
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'position stayed a real number');
        // The real world is 5760x3240 and everyone spawns at the Nexus in the middle. What
        // matters is that a client claiming a position did not get one.
        assert.ok(p.x > 0 && p.x < 5760 && p.y > 0 && p.y < 3240,
            `server kept the player in the world, got ${p.x},${p.y}`);
        assert.ok(Math.abs(p.x - 999999) > 1000 && Math.abs(p.y - 999999) > 1000,
            'the client teleported itself');
        c.close();
    });

    test('separate matches are separate worlds', { skip }, async () => {
        const a = connect(room('t-room-a'), 'x', '&seed=111');
        const b = connect(room('t-room-b'), 'y', '&seed=222');
        await Promise.all([a.ready, b.ready]);
        const wa = await a.until(m => m.find(x => x.t === 'welcome'));
        const wb = await b.until(m => m.find(x => x.t === 'welcome'));
        assert.notEqual(wa.seed, wb.seed);

        const ma = await a.until(m => m.find(x => x.t === 'map'));
        const mb = await b.until(m => m.find(x => x.t === 'map'));
        assert.notDeepEqual(ma.resources, mb.resources,
            'two seeds laid out the same resources');
        a.close(); b.close();
    });

    test('the same seed builds the same world', { skip }, async () => {
        const a = connect(room('t-seed-1'), 'x', '&seed=4242');
        const b = connect(room('t-seed-2'), 'y', '&seed=4242');
        await Promise.all([a.ready, b.ready]);
        // The enemy list is empty during the day, so comparing it agreed for the wrong
        // reason. The map is the thing the seed decides.
        const ma = await a.until(m => m.find(x => x.t === 'map'));
        const mb = await b.until(m => m.find(x => x.t === 'map'));
        assert.deepEqual(ma.resources, mb.resources, 'same seed, different resources');
        assert.deepEqual(ma.decorations, mb.decorations, 'same seed, different scenery');
        a.close(); b.close();
    });
});

// --- the real simulation, server-side ------------------------------------------------------
// MatchRoom stopped simulating drifting blobs and started running src/sim - the same code the
// browser runs. These check that what comes down the wire is an actual game.

describe('MatchRoom runs the real game', () => {
    test('a joining client is handed a real map', { skip }, async () => {
        const c = connect(room('real-map'), 'p1', '&cls=warrior&seed=4242');
        await c.ready;
        const map = await c.until(m => m.find(x => x.t === 'map'));
        assert.ok(map.resources.length > 10, 'the map has no resources: ' + map.resources.length);
        assert.ok(map.decorations.length > 100, 'the map has no scenery');
        assert.equal(typeof map.seed, 'number');
        for (const r of map.resources.slice(0, 5)) {
            assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), 'a resource has no position');
            assert.ok(['wood', 'stone', 'cache'].includes(r.type) || typeof r.type === 'string');
        }
        c.close();
    });

    test('snapshots carry a whole world, on the server clock', { skip }, async () => {
        const c = connect(room('real-snap'), 'p1', '&cls=warrior&seed=4242');
        await c.ready;
        const snap = await c.until(m => m.find(x => x.t === 'snap' && x.tick >= 5));
        assert.equal(snap.phase, 'DAY');
        assert.equal(snap.wave, 1);
        assert.ok(snap.base.hp > 0 && snap.base.maxHp > 0, 'no Nexus in the snapshot');
        assert.equal(snap.players.length, 1);
        const me = snap.players[0];
        assert.equal(me.id, 'p1');
        assert.equal(me.cls, 'warrior');
        assert.ok(me.hp > 0 && me.maxHp > 0 && me.level >= 1, 'the player is not a real player');
        assert.ok(snap.inventory && typeof snap.inventory.wood === 'number');
        assert.ok(typeof snap.weather === 'string');
        c.close();
    });

    test('the phase clock runs on the server', { skip }, async () => {
        const c = connect(room('real-clock'), 'p1', '&seed=4242');
        await c.ready;
        const early = await c.until(m => m.find(x => x.t === 'snap' && x.tick >= 3));
        const later = await c.until(m => m.find(x => x.t === 'snap' && x.tick >= early.tick + 20));
        assert.ok(later.phaseTimer < early.phaseTimer,
            `the day did not advance: ${early.phaseTimer} -> ${later.phaseTimer}`);
        // 20 ticks at 20Hz is one second of game time, give or take a tick.
        const elapsed = early.phaseTimer - later.phaseTimer;
        assert.ok(elapsed > 0.5 && elapsed < 2.5, `a second of ticks moved the clock ${elapsed}s`);
        c.close();
    });

    test('two players share one world and see identical snapshots', { skip }, async () => {
        const id = room('real-coop');
        const a = connect(id, 'alice', '&cls=warrior&seed=4242');
        const b = connect(id, 'bob', '&cls=mage&seed=4242');
        await Promise.all([a.ready, b.ready]);

        // Both have to be in before the comparison is worth anything, and then both need
        // long enough to actually share some ticks - stopping at the first two-player snapshot
        // left exactly one tick in common.
        await a.until(m => m.find(x => x.t === 'snap' && x.players.length === 2));
        await b.until(m => m.find(x => x.t === 'snap' && x.players.length === 2));
        const from = Math.max(
            a.msgs.filter(x => x.t === 'snap').at(-1).tick,
            b.msgs.filter(x => x.t === 'snap').at(-1).tick);
        await a.until(m => m.find(x => x.t === 'snap' && x.tick >= from + 15));
        await b.until(m => m.find(x => x.t === 'snap' && x.tick >= from + 15));

        const byTick = c => new Map(c.msgs.filter(m => m.t === 'snap' && m.players.length === 2)
            .map(m => [m.tick, m]));
        const A = byTick(a), B = byTick(b);
        const shared = [...A.keys()].filter(t => B.has(t));
        assert.ok(shared.length >= 5, `only ${shared.length} ticks seen by both`);
        for (const t of shared) {
            assert.equal(JSON.stringify(A.get(t)), JSON.stringify(B.get(t)),
                `the two clients disagree about tick ${t}`);
        }
        a.close(); b.close();
    });

    test('the Nexus hardens for a party', { skip }, async () => {
        const solo = connect(room('real-solo'), 'p1', '&seed=4242');
        await solo.ready;
        const one = await solo.until(m => m.find(x => x.t === 'snap'));
        const soloHp = one.base.maxHp;
        solo.close();

        const id = room('real-party');
        const a = connect(id, 'a', '&seed=4242');
        const b = connect(id, 'b', '&seed=4242');
        await Promise.all([a.ready, b.ready]);
        const two = await a.until(m => m.find(x => x.t === 'snap' && x.players.length === 2));
        assert.ok(two.base.maxHp > soloHp,
            `two players got the same Nexus as one: ${two.base.maxHp} vs ${soloHp}`);
        a.close(); b.close();
    });

    test('the server moves you; your input is a request', { skip }, async () => {
        const c = connect(room('real-move'), 'p1', '&cls=warrior&seed=4242');
        await c.ready;
        const start = await c.until(m => m.find(x => x.t === 'snap'));
        const x0 = start.players[0].x;

        const iv = setInterval(() => c.send({ t: 'input', moveX: 1, moveY: 0, seq: Date.now() }), 30);
        const moved = await c.until(m => m.find(x => x.t === 'snap' && x.players[0] && x.players[0].x > x0 + 40));
        clearInterval(iv);
        assert.ok(moved.players[0].x > x0, 'walking right did not move the player');

        // and a client cannot simply declare a position
        c.send({ t: 'input', x: 99999, y: 99999, moveX: 0, moveY: 0, seq: Date.now() });
        const after = await c.until(m => m.filter(x => x.t === 'snap').at(-1) &&
            m.filter(x => x.t === 'snap').length > 10 ? m.filter(x => x.t === 'snap').at(-1) : null);
        assert.ok(after.players[0].x < 90000, 'a client teleported itself');
        c.close();
    });
});
