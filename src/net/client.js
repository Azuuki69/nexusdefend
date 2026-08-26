// The client side of a server-authoritative match.
//
// In an online match the browser stops being the game and starts being a window onto it. It
// sends what the player wants; the server says what happened; this file writes that answer into
// the same `world` the renderer already draws from, so not a single line of drawing code had to
// change.
//
// What it deliberately does NOT do yet:
//
//   * interpolate properly. Remote things are eased toward where the server last put them,
//     which hides 20Hz stepping but is not a real interpolation buffer.
//   * predict anything but movement. Attacks, abilities and dashes still wait for the server.
//     Movement is the one you feel.
//
// What it DOES do is predict your own walking: you move the instant you press a key, and the
// server corrects you afterwards if it disagreed.

import { world, useWorld, createWorld, seedRun, fx } from '../sim/world.js';
import { Base, Enemy, Item, Critter, Player, Obstacle, Resource, Merchant, Wanderer } from '../sim/entities.js';
import { MSG, decodeSnapshot, decodeRoster } from './protocol.js';

const INPUT_HZ = 30;

/** Match a live list against a snapshot list by network id, making and dropping as needed. */
function reconcile(list, incoming, make, update) {
    const byId = new Map(list.map(e => [e.nid, e]));
    const next = [];
    for (const s of incoming) {
        let e = byId.get(s.id);
        if (!e) {
            e = make(s);
            e.nid = s.id;
        }
        update(e, s);
        next.push(e);
    }
    // Rebuild in the server's order rather than splicing, so a death in the middle of the list
    // cannot shuffle everything after it onto the wrong sprites.
    list.length = 0;
    for (const e of next) list.push(e);
}

/** Where the server last said this thing was. The renderer eases toward it. */
function target(e, s) {
    e.netX = s.x;
    e.netY = s.y;
    if (e.x === undefined || Math.hypot(e.x - s.x, e.y - s.y) > 400) {
        // First sight, or a jump too big to be movement - a respawn, a teleport, a dash.
        e.x = s.x;
        e.y = s.y;
    }
}

export class MatchClient {
    /**
     * @param {string} url        ws:// or wss:// address of the match
     * @param {object} opts       { cls, onWelcome, onMap, onSnapshot, onClose }
     */
    constructor(url, opts = {}) {
        this.url = url;
        this.opts = opts;
        this.ws = null;
        this.connected = false;
        this.you = null;
        this.hz = 20;
        this.lastTick = -1;
        this.seq = 0;
        this.inputTimer = null;
        this.world = null;
        /** Set once the map has arrived; until then there is nothing to draw. */
        this.ready = false;

        // Slot -> {id, cls}. Snapshots refer to a player by slot, so this has to arrive first.
        this.roster = new Map();
        // The static half of a snapshot, kept because most ticks do not resend it.
        this.header = null;
        // Bytes in, for anyone who wants to know what the match actually costs.
        this.bytesIn = 0;
        this.snapshotsIn = 0;

        // Inputs applied locally but not yet confirmed. Replayed on top of whatever the server
        // says, so a correction does not throw away the keys you pressed since.
        this.unconfirmed = [];
        /** How far the server disagreed with the last prediction, in world units. */
        this.lastError = 0;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            this.ws.binaryType = 'arraybuffer';   // or the browser hands back Blobs
            this.ws.addEventListener('open', () => { this.connected = true; });
            this.ws.addEventListener('message', ev => {
                if (ev.data instanceof ArrayBuffer) { this.onBinary(ev.data); return; }
                let msg;
                try { msg = JSON.parse(ev.data); } catch { return; }
                if (msg.t === 'welcome') {
                    this.you = msg.you;
                    this.hz = msg.hz || 20;
                    this.onWelcome(msg);
                } else if (msg.t === 'map') {
                    this.onMap(msg);
                    this.ready = true;
                    resolve(this);
                } else if (msg.t === 'snap') {
                    this.onSnapshot(msg);
                }
            });
            this.ws.addEventListener('error', () => reject(new Error('could not reach the match')));
            this.ws.addEventListener('close', () => {
                this.connected = false;
                this.stopSendingInput();
                if (this.opts.onClose) this.opts.onClose();
            });
        });
    }

    /** Everything sent per tick comes down here. */
    onBinary(ab) {
        this.bytesIn += ab.byteLength;
        const kind = new DataView(ab).getUint8(0);
        if (kind === MSG.ROSTER) {
            const r = decodeRoster(ab);
            this.roster = new Map(r.players.map(p => [p.slot, p]));
            return;
        }
        if (kind !== MSG.SNAPSHOT) return;
        const out = decodeSnapshot(ab, this.roster, this.header);
        // Null means the header has never arrived - the very first snapshot after connecting
        // can land before the roster. Dropping it costs 50ms and beats inventing a world.
        if (!out) return;
        this.header = out.header;
        this.snapshotsIn++;
        this.onSnapshot(out.snap);
    }

    onWelcome(msg) {
        // A match the server owns: build an empty local world for it and let snapshots fill it.
        this.world = createWorld();
        useWorld(this.world);
        seedRun(msg.seed);
        this.world.gameState = 'DAY';
        this.world.base = new Base();
        if (this.opts.onWelcome) this.opts.onWelcome(msg);
    }

    onMap(msg) {
        const w = useWorld(this.world);
        w.entities.obstacles = msg.obstacles.map(o => Object.assign(new Obstacle(o.x, o.y, o.w, o.h, o.type), o));
        w.entities.decorations = msg.decorations.map(d => ({ ...d }));
        w.entities.resources = msg.resources.map(r => {
            const res = new Resource(r.x, r.y, r.type);
            res.radius = r.radius;
            return res;
        });
        w.entities.npcs = msg.npcs.map(n => {
            const npc = n.shop ? new Merchant() : new Wanderer();
            npc.x = n.x; npc.y = n.y;
            return npc;
        });
        if (this.opts.onMap) this.opts.onMap(msg);
    }

    onSnapshot(snap) {
        // Out of order or duplicated: the newest wins and the rest are noise.
        if (snap.tick <= this.lastTick) return;
        this.lastTick = snap.tick;

        const w = useWorld(this.world);
        w.gameState = snap.phase;
        w.wave = snap.wave;
        w.phaseTimer = snap.phaseTimer;
        w.currentWeather = snap.weather;
        w.currentModifier = snap.modifier;
        Object.assign(w.inventory, snap.inventory);

        if (w.base) {
            w.base.hp = snap.base.hp;
            w.base.maxHp = snap.base.maxHp;
        }

        reconcile(w.players, snap.players,
            s => {
                const p = new Player(s.cls);
                p.netId = s.id;
                return p;
            },
            (p, s) => {
                p.netId = s.id;
                if (s.id === this.you) {
                    // Ours: replay what the server has not seen yet instead of snapping to it.
                    this.reconcile(p, s);
                    p.netX = p.x; p.netY = p.y;
                } else {
                    target(p, s);
                }
                p.hp = s.hp; p.maxHp = s.maxHp;
                p.mp = s.mp; p.maxMp = s.maxMp;
                p.level = s.level;
                p.angle = s.angle;
                // The renderer reads the intent for facing, so keep it pointed the right way.
                p.intent.aimX = s.x + Math.cos(s.angle) * 100;
                p.intent.aimY = s.y + Math.sin(s.angle) * 100;
            });

        reconcile(w.entities.enemies, snap.enemies,
            s => new Enemy(s.x, s.y, s.type),
            (e, s) => {
                target(e, s);
                // Health comes as a byte fraction: the client draws a bar, and 1/255 is finer
                // than the bar is wide. maxHp is whatever this client's own sim gave the
                // creature when it built it, which is the same number the server used.
                e.hp = s.hpPct * e.maxHp;
            });

        reconcile(w.entities.items, snap.items,
            s => new Item(s.x, s.y, s.type),
            (i, s) => { target(i, s); });

        reconcile(w.entities.critters, snap.critters,
            s => new Critter(s.type, s.x, s.y),      // note the order: (type, x, y)
            (c, s) => { target(c, s); if (s.facing !== undefined) c.facing = s.facing; });

        // Projectiles are short-lived and cheap; rebuilding them each snapshot is simpler than
        // tracking them, and nothing about a bullet needs to persist.
        w.entities.projectiles = snap.projectiles.map(p => ({
            nid: p.id, x: p.x, y: p.y, netX: p.x, netY: p.y,
            color: p.color, radius: 5, markedForDeletion: false
        }));

        this.playEvents(snap.events);
        if (this.opts.onSnapshot) this.opts.onSnapshot(snap);
    }

    /** The server's presentation log, played through the client's own sink. */
    playEvents(events) {
        if (!events || !events.length) return;
        for (const e of events) {
            if (e[0] === 'sound') fx.sound(e[1]);
            else if (e[0] === 'particles') fx.particles(e[1], e[2], e[3], e[4]);
            else if (e[0] === 'shake') fx.shake(e[1]);
            // 'text' is skipped: FloatingText objects are created by the simulation itself and
            // would be drawn twice.
        }
    }

    /**
     * Run the player's own movement locally, before the server has answered. Called once a
     * frame with the frame's own dt, so prediction runs at the display rate rather than the
     * tick rate.
     */
    predict(dt) {
        const me = this.localPlayer();
        if (!me || !this.world) return;
        useWorld(this.world);
        const i = me.intent;
        this.unconfirmed.push({ seq: this.seq, dt, moveX: i.moveX, moveY: i.moveY });
        // A second of frames is far more than any sane round trip; past that something is very
        // wrong and replaying a thousand steps would only make it worse.
        if (this.unconfirmed.length > 120) this.unconfirmed.shift();
        me.stepMovement(dt);
    }

    /**
     * The server has spoken. Put the player where it says they were, then replay everything
     * they have done since.
     */
    reconcile(me, s) {
        useWorld(this.world);
        const before = { x: me.x, y: me.y };

        me.x = s.x;
        me.y = s.y;
        this.unconfirmed = this.unconfirmed.filter(u => u.seq > s.seq);
        for (const u of this.unconfirmed) {
            me.intent.moveX = u.moveX;
            me.intent.moveY = u.moveY;
            me.stepMovement(u.dt);
        }
        this.lastError = Math.hypot(me.x - before.x, me.y - before.y);

        // A small disagreement is smoothed away rather than snapped, or every packet would
        // twitch the camera. A large one is a real correction and is applied outright.
        if (this.lastError < 60) {
            me.x = before.x + (me.x - before.x) * 0.25;
            me.y = before.y + (me.y - before.y) * 0.25;
        }
    }

    /**
     * Ease everything toward where the server last put it. Called once a frame, not once a
     * tick, so it smooths 20Hz updates into whatever the display is doing.
     */
    smooth(dt) {
        if (!this.world) return;
        const k = Math.min(1, dt * 14);
        const ease = e => {
            if (e.netX === undefined) return;
            e.x += (e.netX - e.x) * k;
            e.y += (e.netY - e.y) * k;
        };
        const w = this.world;
        // Everyone but us: we are predicted, and easing would fight the prediction.
        w.players.forEach(p => { if (p.netId !== this.you) ease(p); });
        w.entities.enemies.forEach(ease);
        w.entities.critters.forEach(ease);
        w.entities.items.forEach(ease);
    }

    /** Whichever player is this client's own, or null before the first snapshot. */
    localPlayer() {
        if (!this.world) return null;
        return this.world.players.find(p => p.netId === this.you) || null;
    }

    startSendingInput(readIntent) {
        this.stopSendingInput();
        this.inputTimer = setInterval(() => {
            if (!this.connected) return;
            const i = readIntent();
            if (!i) return;
            this.ws.send(JSON.stringify({
                t: 'input',
                moveX: i.moveX, moveY: i.moveY,
                aimX: Math.round(i.aimX), aimY: Math.round(i.aimY),
                attack: i.attack, dash: i.dash, place: i.place,
                ability: i.ability, overcharge: i.overcharge, interact: i.interact,
                seq: ++this.seq
            }));
        }, 1000 / INPUT_HZ);
    }

    stopSendingInput() {
        if (this.inputTimer !== null) { clearInterval(this.inputTimer); this.inputTimer = null; }
    }

    close() {
        this.stopSendingInput();
        try { this.ws && this.ws.close(); } catch { /* already gone */ }
    }
}
