// The wire format, written once and used by both ends.
//
// Why this exists, measured rather than assumed. A JSON snapshot at wave 25 with four players
// came to 11,546 bytes - 225 KB/s per client at 20Hz, against a budget of 10. Enemies were
// 10,808 of those bytes, because every one of them was spelling out
//
//     {"id":417,"type":"goblinarcher","x":2345,"y":1234,"hp":35,"maxHp":35}
//
// seventy characters to say a goblin moved. The same enemy is eight bytes here.
//
// The savings come from three places:
//
//   * names become numbers. A type is one byte, not a quoted word.
//   * positions are int16. The world is 5760x3240, so a whole coordinate fits with room to
//     spare, and nobody can see a fraction of a pixel anyway.
//   * health is a byte fraction. The client draws a bar, not a number, so 1/255 is finer than
//     the screen.
//
// The enums are order-sensitive: appending is safe, reordering silently changes what every
// existing client sees. There is a test that pins them.

export const PROTOCOL_VERSION = 1;

export const MSG = { SNAPSHOT: 1, ROSTER: 2 };

export const ENEMY_TYPES = [
    'goblin', 'wolf', 'orcarcher', 'harpy', 'goblinarcher', 'cyclop', 'troll', 'orcrider',
    'bomber', 'predator', 'assassin', 'necromancer', 'golem', 'boss', 'orcking'
];
export const CRITTER_TYPES = ['boar', 'deer', 'rabbit', 'bear'];
export const ITEM_TYPES = ['hp', 'mp'];
export const PHASES = ['MENU', 'DAY', 'NIGHT', 'OVER'];
export const WEATHERS = ['clear', 'rain', 'fog', 'blizzard', 'bloodmoon'];
export const MODIFIERS = ['none', 'swarm', 'frenzy', 'armored'];
export const CLASSES = ['warrior', 'mage', 'archer', 'priest'];
// How an effect is drawn. Same rule as the lists above: appending is safe, reordering is not.
export const EFFECT_STYLES = ['blob', 'meteor', 'scorched', 'arrowrain', 'whirl', 'nova',
    'heal', 'shield', 'chain', 'frost'];
export const ELEMENTS = ['none', 'fire', 'ice', 'holy', 'poison'];

const idx = (list, v) => {
    const i = list.indexOf(v);
    return i < 0 ? 0 : i;
};
const at = (list, i) => list[i] !== undefined ? list[i] : list[0];

/** Health as a byte. The client draws a bar; 1/255 is finer than the bar is wide. */
const packHp = (hp, maxHp) => {
    if (!(maxHp > 0)) return 0;
    const f = Math.max(0, Math.min(1, hp / maxHp));
    return Math.round(f * 255);
};

class Writer {
    constructor(size = 64 * 1024) {
        this.buf = new DataView(new ArrayBuffer(size));
        this.at = 0;
    }
    u8(v) { this.buf.setUint8(this.at, v & 0xff); this.at += 1; }
    u16(v) { this.buf.setUint16(this.at, Math.max(0, Math.min(65535, v | 0))); this.at += 2; }
    i16(v) { this.buf.setInt16(this.at, Math.max(-32768, Math.min(32767, Math.round(v)))); this.at += 2; }
    u32(v) { this.buf.setUint32(this.at, v >>> 0); this.at += 4; }
    str(s) {
        const bytes = new TextEncoder().encode(String(s).slice(0, 255));
        this.u8(bytes.length);
        for (const b of bytes) this.u8(b);
    }
    done() { return this.buf.buffer.slice(0, this.at); }
}

class Reader {
    constructor(ab) { this.buf = new DataView(ab); this.at = 0; }
    u8() { const v = this.buf.getUint8(this.at); this.at += 1; return v; }
    u16() { const v = this.buf.getUint16(this.at); this.at += 2; return v; }
    i16() { const v = this.buf.getInt16(this.at); this.at += 2; return v; }
    u32() { const v = this.buf.getUint32(this.at); this.at += 4; return v; }
    str() {
        const n = this.u8();
        const bytes = new Uint8Array(this.buf.buffer, this.at, n);
        this.at += n;
        return new TextDecoder().decode(bytes);
    }
    get left() { return this.buf.byteLength - this.at; }
}

/**
 * Who is in the match. Sent when the party changes, not every tick, so the per-tick payload can
 * refer to a player by a one-byte slot instead of spelling out an id.
 */
export function encodeRoster(players) {
    const w = new Writer(4096);
    w.u8(MSG.ROSTER);
    w.u8(players.length);
    for (const p of players) {
        w.u8(p.slot);
        w.u8(idx(CLASSES, p.cls));
        w.str(p.id);
    }
    return w.done();
}

export function decodeRoster(ab) {
    const r = new Reader(ab);
    r.u8();
    const n = r.u8();
    const players = [];
    for (let i = 0; i < n; i++) {
        players.push({ slot: r.u8(), cls: at(CLASSES, r.u8()), id: r.str() });
    }
    return { t: 'roster', players };
}

/**
 * A whole world in a few hundred bytes.
 *
 * `slots` maps a player's network id to its roster slot. Positions are absolute rather than
 * delta-encoded: almost everything in a fight moves every tick, so a delta would spend a
 * changed-mask to save nothing. What deltas DO buy is the static half of the message, which is
 * why the header carries a flag for "nothing up here changed".
 */
export function encodeSnapshot(snap, slots, prevHeader) {
    const w = new Writer();
    w.u8(MSG.SNAPSHOT);
    w.u32(snap.tick);

    const header = [snap.phase, snap.wave, snap.weather, snap.modifier,
                    snap.inventory.wood, snap.inventory.stone, snap.inventory.mana,
                    snap.base.hp, snap.base.maxHp].join('|');
    const headerSame = header === prevHeader;
    w.u8(headerSame ? 0 : 1);
    if (!headerSame) {
        w.u8(idx(PHASES, snap.phase));
        w.u16(snap.wave);
        w.u8(idx(WEATHERS, snap.weather));
        w.u8(idx(MODIFIERS, snap.modifier));
        w.u16(snap.inventory.wood);
        w.u16(snap.inventory.stone);
        w.u16(snap.inventory.mana);
        w.i16(snap.base.x);
        w.i16(snap.base.y);
        w.u16(snap.base.hp);
        w.u16(snap.base.maxHp);
    }
    // The phase clock ticks every frame, so it is never part of the static half.
    w.u16(Math.max(0, Math.round(snap.phaseTimer * 10)));

    w.u8(snap.players.length);
    for (const p of snap.players) {
        w.u8(slots.get(p.id) ?? 0);
        w.i16(p.x); w.i16(p.y);
        w.u16(p.hp); w.u16(p.maxHp);
        w.u16(p.mp); w.u16(p.maxMp);
        w.u8(Math.min(255, p.level));
        w.u8(Math.round(((p.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 255));
        w.u16(p.seq & 0xffff);
        // The pose. Chosen inside update(), which only runs here - without this byte every
        // character on every other screen stands still while gliding around the map.
        w.u8(p.frameX & 3);
        // How far through a swing they are, 0..1. The pose alone was not enough: it says WHICH
        // animation to play and nothing about where in it to be, so a remote character picked
        // the right sequence and then held its first frame.
        //
        // The walk cycle needs no equivalent. It is driven by ground covered, and the client can
        // watch a sprite move for itself.
        w.u8(Math.round(Math.max(0, Math.min(1, p.swing)) * 255));
    }

    w.u16(snap.enemies.length);
    for (const e of snap.enemies) {
        w.u16(e.id & 0xffff);
        w.u8(idx(ENEMY_TYPES, e.type));
        w.i16(e.x); w.i16(e.y);
        w.u8(packHp(e.hp, e.maxHp));
        w.u8(e.frameX & 3);
    }

    w.u16(snap.critters.length);
    for (const c of snap.critters) {
        w.u16(c.id & 0xffff);
        w.u8(idx(CRITTER_TYPES, c.type));
        w.i16(c.x); w.i16(c.y);
        w.u8(c.facing < 0 ? 1 : 0);
        // Wildlife animates and wildlife bleeds; neither was on the wire.
        w.u8(c.frame & 0xff);
        w.u8(packHp(c.hp, c.maxHp));
    }

    w.u16(snap.items.length);
    for (const i of snap.items) {
        w.u16(i.id & 0xffff);
        w.u8(idx(ITEM_TYPES, i.type));
        w.i16(i.x); w.i16(i.y);
    }

    w.u16(snap.projectiles.length);
    for (const p of snap.projectiles) {
        w.u16(p.id & 0xffff);
        w.i16(p.x); w.i16(p.y);
        // Heading and colour: the renderer rotates the sprite to the direction of travel and
        // picks an arrow or a bolt by colour. Without them a projectile cannot be drawn at all.
        w.u8(Math.round(((Math.atan2(p.vy || 0, p.vx || 0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2) * 255));
        w.u8(p.r || 255); w.u8(p.g || 255); w.u8(p.b || 255);
        w.u8(p.explosive ? 1 : 0);
    }

    // Events are rare and irregular, so they stay as text rather than earning a schema.
    // Every spell in the game is an Effect: the meteor, the arrow rain, the whirlwind, every
    // explosion. None of it was on the wire, so casting worked and was invisible.
    w.u16(snap.effects.length);
    for (const e of snap.effects) {
        w.u16(e.id & 0xffff);
        w.u8(idx(EFFECT_STYLES, e.style));
        w.u8(idx(ELEMENTS, e.element));
        w.i16(e.x); w.i16(e.y);
        w.u16(e.radius);
        w.u8(e.r); w.u8(e.g); w.u8(e.b);
        // Tenths of a second: an effect is drawn by how much of its life is left, and nobody
        // can see a hundredth of a second of fade.
        w.u16(Math.round(e.life * 10));
        w.u16(Math.round(e.maxLife * 10));
        w.u8(e.scorched ? 1 : 0);
    }

    const ev = snap.events && snap.events.length ? JSON.stringify(snap.events) : '';
    w.u16(ev.length);
    for (const b of new TextEncoder().encode(ev)) w.u8(b);

    return { buffer: w.done(), header };
}

export function decodeSnapshot(ab, roster, prev) {
    const r = new Reader(ab);
    r.u8();
    const tick = r.u32();
    const hasHeader = r.u8() === 1;

    let head;
    if (hasHeader) {
        head = {
            phase: at(PHASES, r.u8()),
            wave: r.u16(),
            weather: at(WEATHERS, r.u8()),
            modifier: at(MODIFIERS, r.u8()),
            inventory: { wood: r.u16(), stone: r.u16(), mana: r.u16() },
            base: { x: r.i16(), y: r.i16(), hp: r.u16(), maxHp: r.u16() }
        };
    } else {
        // Unchanged since the last one that carried it. A client that has never seen a header
        // cannot make one up, so it says so rather than guessing.
        if (!prev) return null;
        head = prev;
    }

    const snap = {
        t: 'snap', tick,
        phase: head.phase, wave: head.wave, weather: head.weather, modifier: head.modifier,
        inventory: { ...head.inventory }, base: { ...head.base },
        phaseTimer: r.u16() / 10,
        players: [], enemies: [], critters: [], items: [], projectiles: [], effects: [],
        events: []
    };

    const np = r.u8();
    for (let i = 0; i < np; i++) {
        const slot = r.u8();
        const who = roster.get(slot) || { id: 'slot' + slot, cls: 'warrior' };
        snap.players.push({
            id: who.id, cls: who.cls,
            x: r.i16(), y: r.i16(),
            hp: r.u16(), maxHp: r.u16(),
            mp: r.u16(), maxMp: r.u16(),
            level: r.u8(),
            angle: (r.u8() / 255) * Math.PI * 2,
            seq: r.u16(),
            frameX: r.u8() & 3,
            swing: r.u8() / 255
        });
    }

    const ne = r.u16();
    for (let i = 0; i < ne; i++) {
        const id = r.u16();
        const type = at(ENEMY_TYPES, r.u8());
        const x = r.i16(), y = r.i16();
        const hpPct = r.u8() / 255;
        const frameX = r.u8() & 3;
        snap.enemies.push({ id, type, x, y, hpPct, hp: hpPct, maxHp: 1, frameX });
    }

    const nc = r.u16();
    for (let i = 0; i < nc; i++) {
        snap.critters.push({
            id: r.u16(), type: at(CRITTER_TYPES, r.u8()),
            x: r.i16(), y: r.i16(), facing: r.u8() ? -1 : 1,
            frame: r.u8(), hpPct: r.u8() / 255
        });
    }

    const ni = r.u16();
    for (let i = 0; i < ni; i++) {
        snap.items.push({ id: r.u16(), type: at(ITEM_TYPES, r.u8()), x: r.i16(), y: r.i16() });
    }

    const nj = r.u16();
    for (let i = 0; i < nj; i++) {
        const id = r.u16(), x = r.i16(), y = r.i16();
        const a = (r.u8() / 255) * Math.PI * 2;
        const hex = v => v.toString(16).padStart(2, '0');
        const rr = r.u8(), gg = r.u8(), bb = r.u8();
        snap.projectiles.push({
            id, x, y,
            vx: Math.cos(a), vy: Math.sin(a),
            color: '#' + hex(rr) + hex(gg) + hex(bb),
            explosive: r.u8() === 1
        });
    }

    const nfx = r.u16();
    for (let i = 0; i < nfx; i++) {
        const id = r.u16();
        const style = at(EFFECT_STYLES, r.u8());
        const element = at(ELEMENTS, r.u8());
        const x = r.i16(), y = r.i16();
        const radius = r.u16();
        const hex = v => v.toString(16).padStart(2, '0');
        const rr = r.u8(), gg = r.u8(), bb = r.u8();
        snap.effects.push({
            id, style, element, x, y, radius,
            color: '#' + hex(rr) + hex(gg) + hex(bb),
            life: r.u16() / 10,
            maxLife: r.u16() / 10,
            scorched: r.u8() === 1
        });
    }

    const evLen = r.u16();
    if (evLen) {
        const bytes = new Uint8Array(ab, r.at, evLen);
        r.at += evLen;
        try { snap.events = JSON.parse(new TextDecoder().decode(bytes)); } catch { snap.events = []; }
    }

    return { snap, header: head };
}
