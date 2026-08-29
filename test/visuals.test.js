// Can the client DRAW it?
//
// Every other test in this suite asks whether the state is correct, and the state was always
// correct. A playtest found three things wrong with the *picture* that no amount of state
// checking would have caught:
//
//   * every character stood frozen on the idle frame while sliding around the map
//   * every spell was invisible
//   * the effects that did exist would have jittered if they were rebuilt per snapshot
//
// The common cause is that presentation state is decided inside `update()`, which only ever runs
// on the server. Anything the renderer reads and the simulation writes has to be on the wire.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshot, decodeSnapshot, EFFECT_STYLES, ELEMENTS } from '../src/net/protocol.js';

const SLOTS = new Map([['a', 0]]);
const ROSTER = new Map([[0, { slot: 0, id: 'a', cls: 'mage' }]]);

function roundTrip(over = {}) {
    const snap = {
        t: 'snap', tick: 1, phase: 'NIGHT', wave: 3, phaseTimer: 10,
        weather: 'clear', modifier: 'none',
        inventory: { wood: 0, stone: 0, mana: 0 },
        base: { x: 0, y: 0, hp: 1, maxHp: 1 },
        players: [{ id: 'a', cls: 'mage', x: 10, y: 20, hp: 1, maxHp: 1, mp: 1, maxMp: 1,
                    level: 1, angle: 0, seq: 0, frameX: 0 }],
        enemies: [], critters: [], items: [], projectiles: [], effects: [], events: [],
        ...over
    };
    const { buffer } = encodeSnapshot(snap, SLOTS, null);
    return decodeSnapshot(buffer, ROSTER, null).snap;
}

describe('the pose reaches the other screen', () => {
    test('a player carries which frame they are on', () => {
        for (const frameX of [0, 1, 2]) {
            const back = roundTrip({
                players: [{ id: 'a', cls: 'mage', x: 10, y: 20, hp: 1, maxHp: 1, mp: 1, maxMp: 1,
                            level: 1, angle: 0, seq: 0, frameX }]
            });
            assert.equal(back.players[0].frameX, frameX,
                'the pose was lost, so this character stands still while gliding around');
        }
    });

    test('an enemy carries one too', () => {
        const back = roundTrip({
            enemies: [{ id: 7, type: 'goblin', x: 5, y: 6, hp: 10, maxHp: 10, frameX: 2 }]
        });
        assert.equal(back.enemies[0].frameX, 2);
    });

    test('a missing pose decodes as idle rather than as undefined', () => {
        const back = roundTrip({
            players: [{ id: 'a', cls: 'mage', x: 1, y: 2, hp: 1, maxHp: 1, mp: 1, maxMp: 1,
                        level: 1, angle: 0, seq: 0 }]     // no frameX at all
        });
        assert.equal(back.players[0].frameX, 0);
    });
});

describe('spells reach the other screen', () => {
    test('an effect survives the round trip with what it needs to be drawn', () => {
        const back = roundTrip({
            effects: [{ id: 14, style: 'meteor', element: 'fire', x: 900, y: -1200, radius: 150,
                        life: 0.6, maxLife: 1.0, scorched: false, r: 255, g: 102, b: 0 }]
        });
        const e = back.effects[0];
        assert.equal(e.id, 14);
        assert.equal(e.style, 'meteor', 'without the style it cannot be drawn as anything');
        assert.equal(e.element, 'fire');
        assert.equal(e.x, 900);
        assert.equal(e.y, -1200, 'a negative coordinate wrapped');
        assert.equal(e.radius, 150);
        assert.equal(e.color, '#ff6600');
        // The fade is drawn from life against maxLife, so both have to arrive.
        assert.ok(Math.abs(e.life - 0.6) < 0.06, 'life: ' + e.life);
        assert.ok(Math.abs(e.maxLife - 1.0) < 0.06, 'maxLife: ' + e.maxLife);
    });

    test('several at once all arrive', () => {
        const many = ['blob', 'arrowrain', 'scorched', 'whirl'].map((style, i) => ({
            id: 100 + i, style, element: 'none', x: i * 10, y: i * 10, radius: 40,
            life: 1, maxLife: 1, scorched: style === 'scorched', r: 1, g: 2, b: 3
        }));
        const back = roundTrip({ effects: many });
        assert.equal(back.effects.length, 4);
        assert.deepEqual(back.effects.map(e => e.style), ['blob', 'arrowrain', 'scorched', 'whirl']);
        assert.equal(back.effects[2].scorched, true);
    });

    test('an unknown style decodes to something drawable rather than crashing', () => {
        const back = roundTrip({
            effects: [{ id: 1, style: 'not-a-real-style', element: 'not-real', x: 0, y: 0,
                        radius: 10, life: 1, maxLife: 1, scorched: false, r: 0, g: 0, b: 0 }]
        });
        assert.equal(back.effects[0].style, EFFECT_STYLES[0]);
        assert.equal(back.effects[0].element, ELEMENTS[0]);
    });

    test('no effects is not the same as broken effects', () => {
        assert.deepEqual(roundTrip().effects, []);
    });
});

describe('wildlife animates and bleeds', () => {
    test('a critter carries its frame and its wound', () => {
        const back = roundTrip({
            critters: [{ id: 11, type: 'deer', x: 100, y: 200, facing: -1,
                         frame: 3, hp: 20, maxHp: 55 }]
        });
        const c = back.critters[0];
        assert.equal(c.frame, 3, 'without a frame every deer stands in one pose forever');
        // Health arrives as a byte fraction, the same as an enemy's: the client draws a bar.
        assert.ok(Math.abs(c.hpPct - 20 / 55) < 0.01, 'hpPct was ' + c.hpPct);
    });

    test('an untouched animal reads as full rather than as missing', () => {
        const back = roundTrip({
            critters: [{ id: 12, type: 'boar', x: 0, y: 0, facing: 1,
                         frame: 0, hp: 90, maxHp: 90 }]
        });
        assert.equal(back.critters[0].hpPct, 1);
        assert.equal(back.critters[0].facing, 1);
    });
});

describe('the enums stay append-only', () => {
    test('the styles and elements are pinned', () => {
        // Reordering these silently changes what every existing client draws.
        assert.deepEqual(EFFECT_STYLES.slice(0, 4), ['blob', 'meteor', 'scorched', 'arrowrain']);
        assert.equal(ELEMENTS[0], 'none');
    });
});
