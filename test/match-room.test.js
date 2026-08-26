// End-to-end against a running `wrangler dev` on :8787.
//
// Skipped automatically when the dev server is not up, so `npm test` stays green without it.
// Start it with:  npx wrangler dev --port 8787 --local

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:8787';
const WS = 'ws://127.0.0.1:8787';

// Probed at module load with top-level await, so `skip` receives a real boolean. Passing a
// function here silently skips everything, because a function is truthy.
let up = false;
try {
    up = (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) })).ok;
} catch { up = false; }
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
    open.add(ws);
    const msgs = [];
    ws.addEventListener('message', (e) => msgs.push(JSON.parse(e.data)));
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
        assert.ok(p.x >= 0 && p.x <= 1000 && p.y >= 0 && p.y <= 1000,
            `server kept the player in bounds, got ${p.x},${p.y}`);
        c.close();
    });

    test('separate matches are separate worlds', { skip }, async () => {
        const a = connect(room('t-room-a'), 'x', '&seed=111');
        const b = connect(room('t-room-b'), 'y', '&seed=222');
        await Promise.all([a.ready, b.ready]);
        const wa = await a.until(m => m.find(x => x.t === 'welcome'));
        const wb = await b.until(m => m.find(x => x.t === 'welcome'));
        assert.notEqual(wa.seed, wb.seed);

        await a.until(m => m.filter(x => x.t === 'snap').length >= 5);
        await b.until(m => m.filter(x => x.t === 'snap').length >= 5);
        const ea = a.msgs.filter(x => x.t === 'snap').at(-1).enemies;
        const eb = b.msgs.filter(x => x.t === 'snap').at(-1).enemies;
        assert.notDeepEqual(ea, eb, 'different seeds should produce different worlds');
        a.close(); b.close();
    });

    test('the same seed builds the same world', { skip }, async () => {
        const a = connect(room('t-seed-1'), 'x', '&seed=4242');
        const b = connect(room('t-seed-2'), 'y', '&seed=4242');
        await Promise.all([a.ready, b.ready]);
        const sa = await a.until(m => m.find(x => x.t === 'snap' && x.tick === 3));
        const sb = await b.until(m => m.find(x => x.t === 'snap' && x.tick === 3));
        assert.deepEqual(sa.enemies, sb.enemies, 'same seed, same enemies at the same tick');
        a.close(); b.close();
    });
});
