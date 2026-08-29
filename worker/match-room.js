// The authority for one match.
//
// It runs the same simulation the browser runs - src/sim, imported unchanged - on the server's
// own clock. Clients send what they want to do; the server decides what happened and says so.
//
// Three constraints worth knowing before changing anything here:
//
//   * This uses a plain WebSocket accept, NOT the Hibernation API. A hibernating object is
//     evicted between messages, which would kill the tick timer mid-match. Hibernation is right
//     for a lobby or an idle party; it is wrong here.
//
//   * Durable Objects share module scope - measured, not assumed. So the simulation's `world`
//     binding is pointed at this match with useWorld() before every step, and the step must stay
//     SYNCHRONOUS. An await inside the tick would let another match interleave and quietly
//     corrupt both.
//
//   * The client is not trusted for anything. Input arrives as intent - a direction, an aim
//     point, some booleans - and is clamped on the way in. A client saying "I am at the boss"
//     is a client saying something, not a fact.

import { createWorld, useWorld, seedRun, setFxMode, drainFx, livingPlayers } from '../src/sim/world.js';
import { Base, Player, Merchant, Wanderer, merchantVisits } from '../src/sim/entities.js';
import { stepWorld, generateMap, stockWildlife } from '../src/sim/tick.js';
import { encodeSnapshot, encodeRoster } from '../src/net/protocol.js';

const TICK_HZ = 20;
const TICK_MS = 1000 / TICK_HZ;
const TICK_DT = 1 / TICK_HZ;
const EMPTY_SHUTDOWN_MS = 30_000;   // stop ticking once everyone has gone
const REJOIN_GRACE_MS = 60_000;     // how long a dropped player's place is held
const MAX_PLAYERS = 4;
const CLASSES = new Set(['warrior', 'mage', 'archer', 'priest']);

const r1 = n => Math.round(n * 10) / 10;

export class MatchRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;

        /** @type {Map<WebSocket, Player>} */
        this.clients = new Map();

        this.timer = null;
        this.emptySince = null;
        this.tick = 0;
        this.world = null;

        // A player's roster slot. Sending a one-byte slot every tick instead of a string id is
        // most of why a snapshot fits in a few hundred bytes.
        this.slots = new Map();      // netId -> slot
        this.nextSlot = 0;
        // netId -> { player, since }. A dropped connection does not throw the character away;
        // a blip on mobile data should not cost somebody their run.
        this.orphans = new Map();
        // The static half of a snapshot - phase, wave, weather, the Nexus - is usually the same
        // as last tick, so it is only sent when it changes. A client that has just arrived has
        // no copy of it, hence the flag.
        this.prevHeader = null;
        this.forceHeader = true;
    }

    // ---------------------------------------------------------------- world

    initWorld(seed) {
        this.world = createWorld();
        useWorld(this.world);
        seedRun(seed);

        this.world.base = new Base();
        this.world.gameState = 'DAY';
        generateMap();
        // Everything a local run gets at dawn. Without these the world had no merchant, no
        // wayfarer and no wildlife - a map with nothing living on it.
        if (merchantVisits(this.world.wave)) this.world.entities.npcs.push(new Merchant());
        this.world.entities.npcs.push(new Wanderer());
        stockWildlife();

        // Nothing here can play a sound or draw a particle, so the presentation calls the
        // simulation makes become a list instead. The client renders them.
        setFxMode('record');
        drainFx();
    }

    /** Point the simulation at this match. Every entry point does this first. */
    enter() {
        useWorld(this.world);
        return this.world;
    }

    addPlayer(netId, cls) {
        const w = this.enter();

        // Coming back to a place we kept: the same character, where they left it.
        const held = this.orphans.get(netId);
        if (held) {
            this.orphans.delete(netId);
            w.players.push(held.player);
            w.base.recalcMaxHp();
            return held.player;
        }

        const p = new Player(CLASSES.has(cls) ? cls : 'warrior');
        p.netId = netId;
        if (!this.slots.has(netId)) this.slots.set(netId, this.nextSlot++ & 0xff);
        w.players.push(p);
        w.base.recalcMaxHp();        // the Nexus hardens with the party
        return p;
    }

    /** Forget anyone who did not come back in time. */
    sweepOrphans() {
        const now = Date.now();
        for (const [netId, held] of this.orphans) {
            if (now - held.since > REJOIN_GRACE_MS) {
                this.orphans.delete(netId);
                this.slots.delete(netId);
            }
        }
    }

    removePlayer(p) {
        const w = this.enter();
        const i = w.players.indexOf(p);
        if (i >= 0) w.players.splice(i, 1);
        if (w.base) w.base.recalcMaxHp();
        // Out of the world, but not gone: held for a minute in case they come back.
        if (p.netId) this.orphans.set(p.netId, { player: p, since: Date.now() });
    }

    // ---------------------------------------------------------------- the tick

    step() {
        this.enter();
        stepWorld(TICK_DT);          // synchronous, deliberately - see the note at the top
        this.tick++;
        return drainFx();
    }

    /** The map, which changes at dawn rather than every tick. Sent on join and on regeneration. */
    mapMessage() {
        const w = this.enter();
        return {
            t: 'map',
            seed: w.currentSeed,
            obstacles: w.entities.obstacles.map(o => ({ type: o.type, x: Math.round(o.x), y: Math.round(o.y), w: o.w, h: o.h })),
            resources: w.entities.resources.map(r => ({ type: r.type, x: Math.round(r.x), y: Math.round(r.y), radius: r.radius })),
            // Verbatim: every one of these fields is a sprite-sheet rectangle the renderer
            // needs. Sending x and y alone left the client with 614 nameless dots.
            decorations: w.entities.decorations,
            // What a tree actually collides with. Without these the client predicts straight
            // through trunks the server stops at, and drifts further with every step.
            solids: w.entities.solids.map(s => ({ x: Math.round(s.x), y: Math.round(s.y), r: Math.round(s.r) })),
            npcs: w.entities.npcs.map(n => ({ shop: !!n.isShop, x: Math.round(n.x), y: Math.round(n.y) }))
        };
    }

    /**
     * A whole world, every tick. JSON and uncompressed on purpose: correctness first, and a
     * snapshot you can read in a console is worth a lot while the protocol is still moving.
     * Deltas and a binary encoding are Phase 3.
     */
    snapshot(events) {
        const w = this.enter();
        return {
            t: 'snap',
            tick: this.tick,
            phase: w.gameState,
            wave: w.wave,
            phaseTimer: r1(w.phaseTimer),
            weather: w.currentWeather,
            modifier: w.currentModifier,
            inventory: w.inventory,
            base: { x: Math.round(w.base.x), y: Math.round(w.base.y), hp: Math.round(w.base.hp), maxHp: w.base.maxHp },
            players: w.players.map(p => ({
                id: p.netId, cls: p.cls,
                x: Math.round(p.x), y: Math.round(p.y),
                hp: Math.round(p.hp), maxHp: p.maxHp,
                mp: Math.round(p.mp), maxMp: p.maxMp,
                level: p.level, angle: r1(p.angle),
                seq: p.intent.seq
            })),
            enemies: w.entities.enemies.map(e => ({
                id: e.nid, type: e.type, x: Math.round(e.x), y: Math.round(e.y),
                hp: Math.round(e.hp), maxHp: e.maxHp
            })),
            projectiles: w.entities.projectiles.map(p => {
                const c = /^#([0-9a-f]{6})$/i.exec(p.color || '#ffffff');
                const v = c ? parseInt(c[1], 16) : 0xffffff;
                return {
                    id: p.nid, x: Math.round(p.x), y: Math.round(p.y),
                    vx: p.vx, vy: p.vy, explosive: !!p.isExplosive,
                    r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff
                };
            }),
            items: w.entities.items.map(i => ({ id: i.nid, type: i.type, x: Math.round(i.x), y: Math.round(i.y) })),
            critters: w.entities.critters.map(c => ({ id: c.nid, type: c.type, x: Math.round(c.x), y: Math.round(c.y), facing: c.facing })),
            events
        };
    }

    // ---------------------------------------------------------------- tick loop

    startLoop() {
        if (this.timer !== null) return;
        let next = Date.now() + TICK_MS;
        const run = () => {
            this.sweepOrphans();
            const events = this.step();
            const snap = this.snapshot(events);
            const { buffer, header } = encodeSnapshot(
                snap, this.slots, this.forceHeader ? null : this.prevHeader);
            this.prevHeader = header;
            this.forceHeader = false;
            this.broadcast(buffer);

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

    broadcast(payload) {
        for (const [ws] of this.clients) {
            try { ws.send(payload); } catch { this.drop(ws); }
        }
    }

    /** Who is in the match, by slot. Sent on any change, never per tick. */
    rosterMessage() {
        return encodeRoster([...this.clients.values()].map(p => ({
            slot: this.slots.get(p.netId) ?? 0, id: p.netId, cls: p.cls
        })));
    }

    drop(ws) {
        const p = this.clients.get(ws);
        this.clients.delete(ws);
        if (p) {
            this.removePlayer(p);
            if (this.clients.size) this.broadcast(this.rosterMessage());
        }
    }

    // ---------------------------------------------------------------- connections

    async fetch(request) {
        const url = new URL(request.url);
        const netId = (url.searchParams.get('player') || '').slice(0, 32) || crypto.randomUUID();
        const cls = url.searchParams.get('cls') || 'warrior';

        if (!this.world) {
            const seedParam = Number(url.searchParams.get('seed'));
            this.initWorld(Number.isFinite(seedParam) && seedParam > 0
                ? seedParam >>> 0
                : (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0));
        }

        if (this.clients.size >= MAX_PLAYERS) {
            return new Response('match is full', { status: 409 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        server.accept();                       // deliberately not hibernation - see the note above

        const player = this.addPlayer(netId, cls);
        this.clients.set(server, player);

        server.addEventListener('message', (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }
            if (msg.t !== 'input') return;
            this.applyInput(player, msg);
        });

        const close = () => this.drop(server);
        server.addEventListener('close', close);
        server.addEventListener('error', close);

        server.send(JSON.stringify({
            t: 'welcome', you: netId, cls: player.cls,
            slot: this.slots.get(netId), seed: this.world.currentSeed, hz: TICK_HZ
        }));
        server.send(JSON.stringify(this.mapMessage()));
        // The party changed, and the newcomer has no static header yet.
        this.broadcast(this.rosterMessage());
        this.forceHeader = true;
        this.startLoop();

        return new Response(null, { status: 101, webSocket: client });
    }

    /**
     * Everything a client sends is a request, not a fact. Movement is clamped to a unit vector,
     * the aim point is clamped to the world, and nothing here can set a position.
     */
    applyInput(player, msg) {
        const i = player.intent;
        const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

        let mx = num(msg.moveX), my = num(msg.moveY);
        const len = Math.hypot(mx, my);
        if (len > 1) { mx /= len; my /= len; }
        i.moveX = mx;
        i.moveY = my;

        i.aimX = num(msg.aimX, player.x);
        i.aimY = num(msg.aimY, player.y);

        i.attack = !!msg.attack;
        i.dash = !!msg.dash;
        i.place = !!msg.place;
        // Edge actions are latched until the tick consumes them, so a 30Hz client talking to a
        // 20Hz server cannot lose a keypress between frames.
        if (msg.ability) i.ability = true;
        if (msg.overcharge) i.overcharge = true;
        if (msg.interact) i.interact = true;

        i.seq = Math.max(i.seq, num(msg.seq, i.seq));
    }
}
