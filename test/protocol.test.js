// The wire format.
//
// Two things can go wrong here and both are silent. A field can round-trip to the wrong value,
// which shows up as a creature standing in the wrong place. And an enum can be reordered, which
// turns every goblin in every already-loaded client into a wolf. Both are pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    MSG, PROTOCOL_VERSION, ENEMY_TYPES, CRITTER_TYPES, ITEM_TYPES,
    PHASES, WEATHERS, MODIFIERS, CLASSES,
    encodeSnapshot, decodeSnapshot, encodeRoster, decodeRoster
} from '../src/net/protocol.js';

const roster = players => new Map(
    decodeRoster(encodeRoster(players.map((p, i) => ({ slot: i, id: p.id, cls: p.cls }))))
        .players.map(p => [p.slot, p]));
const slotsOf = players => new Map(players.map((p, i) => [p.id, i]));

function sampleSnapshot(over = {}) {
    const players = over.players || [
        { id: 'alice', cls: 'warrior', x: 2880, y: 1835, hp: 180, maxHp: 200, mp: 50, maxMp: 80, level: 9, angle: 1.2, seq: 1234 }
    ];
    return {
        t: 'snap', tick: 5000, phase: 'NIGHT', wave: 25, phaseTimer: 42.3,
        weather: 'bloodmoon', modifier: 'swarm',
        inventory: { wood: 120, stone: 80, mana: 300 },
        base: { x: 2880, y: 1620, hp: 1400, maxHp: 1750 },
        players,
        enemies: [{ id: 7, type: 'orcking', x: 1000, y: 2000, hp: 500, maxHp: 1000 }],
        critters: [{ id: 11, type: 'deer', x: 100, y: 200, facing: -1 }],
        items: [{ id: 12, type: 'mp', x: 5, y: 6 }],
        projectiles: [{ id: 13, x: 7, y: 8, color: '#fff' }],
        // Every spell in the game is one of these, and none of them were on the wire until a
        // playtest found a mage casting into an empty field.
        effects: [{ id: 14, style: 'meteor', element: 'fire', x: 900, y: 1200, radius: 150,
                    life: 0.6, maxLife: 1.0, scorched: false, r: 255, g: 102, b: 0 }],
        events: [],
        ...over
    };
}

test('a snapshot survives the round trip', () => {
    const snap = sampleSnapshot();
    const { buffer } = encodeSnapshot(snap, slotsOf(snap.players), null);
    const { snap: back } = decodeSnapshot(buffer, roster(snap.players), null);

    assert.equal(back.tick, snap.tick);
    assert.equal(back.phase, 'NIGHT');
    assert.equal(back.wave, 25);
    assert.equal(back.weather, 'bloodmoon');
    assert.equal(back.modifier, 'swarm');
    assert.ok(Math.abs(back.phaseTimer - 42.3) < 0.05, 'the phase clock drifted');
    assert.deepEqual(back.inventory, snap.inventory);
    assert.deepEqual(back.base, snap.base);
    assert.equal(back.players[0].id, 'alice');
    assert.equal(back.players[0].cls, 'warrior');
    assert.equal(back.enemies[0].type, 'orcking');
    assert.equal(back.critters[0].facing, -1);
    assert.equal(back.items[0].type, 'mp');
});

test('coordinates survive being negative and being large', () => {
    const snap = sampleSnapshot({
        enemies: [
            { id: 1, type: 'goblin', x: -500, y: 3239, hp: 1, maxHp: 1 },
            { id: 2, type: 'wolf', x: 5759, y: 0, hp: 1, maxHp: 1 }
        ]
    });
    const { buffer } = encodeSnapshot(snap, slotsOf(snap.players), null);
    const { snap: back } = decodeSnapshot(buffer, roster(snap.players), null);
    assert.equal(back.enemies[0].x, -500, 'a negative coordinate was mangled');
    assert.equal(back.enemies[0].y, 3239);
    assert.equal(back.enemies[1].x, 5759, 'the far edge of the world was mangled');
});

test('health arrives as a fraction the client can draw', () => {
    const snap = sampleSnapshot({
        enemies: [
            { id: 1, type: 'goblin', x: 0, y: 0, hp: 50, maxHp: 100 },
            { id: 2, type: 'goblin', x: 0, y: 0, hp: 0, maxHp: 100 },
            { id: 3, type: 'goblin', x: 0, y: 0, hp: 100, maxHp: 100 }
        ]
    });
    const { buffer } = encodeSnapshot(snap, slotsOf(snap.players), null);
    const { snap: back } = decodeSnapshot(buffer, roster(snap.players), null);
    assert.ok(Math.abs(back.enemies[0].hpPct - 0.5) < 0.01, 'half health did not survive');
    assert.equal(back.enemies[1].hpPct, 0, 'a dead thing was not at zero');
    assert.equal(back.enemies[2].hpPct, 1, 'a full thing was not at one');
});

test('the static half is only sent when it changes, and never invented', () => {
    const snap = sampleSnapshot();
    const slots = slotsOf(snap.players), r = roster(snap.players);
    const first = encodeSnapshot(snap, slots, null);
    const second = encodeSnapshot({ ...snap, tick: 5001 }, slots, first.header);
    assert.ok(second.buffer.byteLength < first.buffer.byteLength,
        'an unchanged header cost the same as a changed one');

    const { snap: back1, header } = decodeSnapshot(first.buffer, r, null);
    const { snap: back2 } = decodeSnapshot(second.buffer, r, header);
    assert.equal(back2.wave, back1.wave, 'the carried-over header was lost');
    assert.equal(back2.weather, back1.weather);

    // A client that joined mid-match has no header. It must say so, not guess.
    assert.equal(decodeSnapshot(second.buffer, r, null), null,
        'a client with no header invented a world');
});

test('a changed header is sent again', () => {
    const snap = sampleSnapshot();
    const slots = slotsOf(snap.players);
    const first = encodeSnapshot(snap, slots, null);
    const changed = encodeSnapshot({ ...snap, wave: 26 }, slots, first.header);
    assert.equal(changed.buffer.byteLength, first.buffer.byteLength,
        'a changed header was elided anyway');
});

test('the enums are append-only', () => {
    // Reordering any of these silently turns every goblin in an already-loaded client into a
    // wolf. Adding to the end is safe; this pins the prefix that already shipped.
    assert.equal(PROTOCOL_VERSION, 1);
    assert.deepEqual(ENEMY_TYPES.slice(0, 15), [
        'goblin', 'wolf', 'orcarcher', 'harpy', 'goblinarcher', 'cyclop', 'troll', 'orcrider',
        'bomber', 'predator', 'assassin', 'necromancer', 'golem', 'boss', 'orcking'
    ]);
    assert.deepEqual(CRITTER_TYPES.slice(0, 4), ['boar', 'deer', 'rabbit', 'bear']);
    assert.deepEqual(ITEM_TYPES.slice(0, 2), ['hp', 'mp']);
    assert.deepEqual(PHASES.slice(0, 4), ['MENU', 'DAY', 'NIGHT', 'OVER']);
    assert.deepEqual(WEATHERS.slice(0, 5), ['clear', 'rain', 'fog', 'blizzard', 'bloodmoon']);
    assert.deepEqual(CLASSES.slice(0, 4), ['warrior', 'mage', 'archer', 'priest']);
    assert.equal(MSG.SNAPSHOT, 1);
    assert.equal(MSG.ROSTER, 2);
});

test('an unknown name decodes to something rather than crashing', () => {
    // A client one version behind should show the wrong sprite, not throw.
    const snap = sampleSnapshot({
        enemies: [{ id: 1, type: 'a-type-from-the-future', x: 0, y: 0, hp: 1, maxHp: 1 }]
    });
    const { buffer } = encodeSnapshot(snap, slotsOf(snap.players), null);
    const { snap: back } = decodeSnapshot(buffer, roster(snap.players), null);
    assert.ok(ENEMY_TYPES.includes(back.enemies[0].type), 'an unknown type broke the decode');
});

test('it is dramatically smaller than the JSON it replaced', () => {
    // The measurement that justified the work: 158 enemies and four players came to 11,546
    // bytes of JSON, which is 225 KB/s at 20Hz against a 10 KB/s budget.
    const players = Array.from({ length: 4 }, (_, i) => ({
        id: 'p' + i, cls: CLASSES[i], x: 2880 + i * 40, y: 1835,
        hp: 180, maxHp: 200, mp: 50, maxMp: 80, level: 9, angle: 1.2, seq: 1234
    }));
    const enemies = Array.from({ length: 158 }, (_, i) => ({
        id: i + 1, type: ENEMY_TYPES[i % ENEMY_TYPES.length],
        x: 1000 + i * 7, y: 900 + i * 3, hp: 30 + i, maxHp: 60 + i
    }));
    const snap = sampleSnapshot({ players, enemies });
    const json = JSON.stringify(snap).length;
    const { buffer } = encodeSnapshot(snap, slotsOf(players), null);
    const ratio = json / buffer.byteLength;
    assert.ok(ratio > 6, `only ${ratio.toFixed(1)}x smaller than JSON`);
    assert.ok(buffer.byteLength < 2000,
        `a worst-case snapshot is ${buffer.byteLength} bytes; it should fit in a couple of KB`);
});
