// The authority for one match.
//
// This is a spike, not the finished MatchRoom: the world it simulates is deliberately tiny.
// What it is proving is the shape everything else depends on -
//
//   * one object owns the state, and clients can only send intents
//   * a fixed tick runs on the server, independent of any client's frame rate
//   * every connected client sees the same world at the same tick
//   * the world is seeded, so the same match can be replayed
//
// The one non-obvious constraint: this uses a plain WebSocket accept, NOT the Hibernation
// API. A hibernating object is evicted between messages, which would kill the tick timer
// mid-match. Hibernation is right for a lobby or a party that sits idle; it is wrong here.

import { mulberry32 } from '../src/sim/rng.js';

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const EMPTY_SHUTDOWN_MS = 30_000;   // stop ticking once everyone has gone

export class MatchRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;

        /** @type {Map<WebSocket, {id: string, lastSeq: number}>} */
        this.clients = new Map();

        this.timer = null;
        this.emptySince = null;
        this.seed = null;
        this.world = null;
    }

    // ---------------------------------------------------------------- world

    initWorld(seed) {
        const rng = mulberry32(seed);
        this.seed = seed;
        this.world = {
            tick: 0,
            rng,
            players: new Map(),
            // A handful of drifting blobs stands in for the horde. The point is that the
            // server moves them and nobody else does.
            enemies: Array.from({ length: 12 }, (_, i) => ({
                id: i,
                x: rng() * 1000,
                y: rng() * 1000,
                vx: (rng() - 0.5) * 40,
                vy: (rng() - 0.5) * 40
            }))
        };
    }

    step() {
        const w = this.world;
        w.tick++;
        const dt = TICK_MS / 1000;

        for (const e of w.enemies) {
            e.x += e.vx * dt;
            e.y += e.vy * dt;
            if (e.x < 0 || e.x > 1000) { e.vx *= -1; e.x = Math.max(0, Math.min(1000, e.x)); }
            if (e.y < 0 || e.y > 1000) { e.vy *= -1; e.y = Math.max(0, Math.min(1000, e.y)); }
        }

        // Intents are applied here, on the server's clock - never trusted as positions.
        for (const p of w.players.values()) {
            const speed = 200;
            p.x = Math.max(0, Math.min(1000, p.x + p.moveX * speed * dt));
            p.y = Math.max(0, Math.min(1000, p.y + p.moveY * speed * dt));
        }
    }

    snapshot() {
        const w = this.world;
        return {
            t: 'snap',
            tick: w.tick,
            seed: this.seed,
            players: [...w.players.values()].map(p => ({
                id: p.id, x: Math.round(p.x), y: Math.round(p.y), seq: p.lastSeq
            })),
            enemies: w.enemies.map(e => ({ id: e.id, x: Math.round(e.x), y: Math.round(e.y) }))
        };
    }

    // ---------------------------------------------------------------- tick loop

    startLoop() {
        if (this.timer !== null) return;
        let next = Date.now() + TICK_MS;
        const run = () => {
            this.step();
            this.broadcast(this.snapshot());

            if (this.clients.size === 0) {
                if (this.emptySince === null) this.emptySince = Date.now();
                if (Date.now() - this.emptySince > EMPTY_SHUTDOWN_MS) { this.stopLoop(); return; }
            } else {
                this.emptySince = null;
            }

            // Schedule against a running deadline rather than a fixed delay, so a slow tick
            // does not push every later tick permanently late.
            next += TICK_MS;
            this.timer = setTimeout(run, Math.max(0, next - Date.now()));
        };
        this.timer = setTimeout(run, TICK_MS);
    }

    stopLoop() {
        if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    }

    broadcast(msg) {
        const payload = JSON.stringify(msg);
        for (const [ws] of this.clients) {
            try { ws.send(payload); } catch { this.drop(ws); }
        }
    }

    drop(ws) {
        this.clients.delete(ws);
        if (this.world) this.world.players.delete(ws.__playerId);
    }

    // ---------------------------------------------------------------- connections

    async fetch(request) {
        const url = new URL(request.url);

        const playerId = (url.searchParams.get('player') || '').slice(0, 32) || crypto.randomUUID();

        if (!this.world) {
            const seedParam = Number(url.searchParams.get('seed'));
            this.initWorld(Number.isFinite(seedParam) && seedParam > 0
                ? seedParam >>> 0
                : (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0));
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();                       // deliberately not hibernation - see the note above

        server.__playerId = playerId;
        this.clients.set(server, { id: playerId, lastSeq: 0 });
        this.world.players.set(playerId, {
            id: playerId, x: 500, y: 500, moveX: 0, moveY: 0, lastSeq: 0
        });

        server.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            const p = this.world.players.get(playerId);
            if (!p) return;

            if (msg.t === 'input') {
                // Clamp everything. A client saying "my speed is 9000" is just a client
                // saying something; the server decides what happens.
                const mx = Number(msg.moveX) || 0, my = Number(msg.moveY) || 0;
                const len = Math.hypot(mx, my) || 1;
                p.moveX = len > 1 ? mx / len : mx;
                p.moveY = len > 1 ? my / len : my;
                p.lastSeq = Number(msg.seq) || p.lastSeq;
            }
        });

        const close = () => this.drop(server);
        server.addEventListener('close', close);
        server.addEventListener('error', close);

        server.send(JSON.stringify({ t: 'welcome', you: playerId, seed: this.seed, hz: TICK_HZ }));
        this.startLoop();

        return new Response(null, { status: 101, webSocket: client });
    }
}
