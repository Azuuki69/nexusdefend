// Buffs and class data belong to a player, not to the match.
//
// Two leaks of the same shape shipped in the game and are guarded here:
//
//   1. Talents wrote into a single global `playerBuffs`, and resetTalents never took the
//      contribution back out. Buy Bloodthirst, drink an Amnesia Potion, rebuy: vampirism went
//      0.06 -> 0.12 -> 0.18, without limit.
//   2. Four talents write into `data` rather than a buff. Same story: six resets ratcheted
//      Meteor's cooldown from 6s to the 1s floor and its cost from 40 mana to 9.
//
// The game needs a DOM, so rather than booting it these tests lift the real talentData literal
// out of index.html and run the actual closures against a mock player. That is enough, because
// the closures touch nothing but the player handed to them - which is the property being
// protected in the first place.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

/** Lift a top-level `const NAME = {...};` literal out of the game and evaluate it. */
function lift(name) {
    const start = SRC.indexOf('const ' + name + ' = {');
    assert.notEqual(start, -1, name + ' not found in index.html');
    const open = SRC.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < SRC.length; i++) {
        if (SRC[i] === '{') depth++;
        else if (SRC[i] === '}' && --depth === 0) { end = i + 1; break; }
    }
    assert.notEqual(end, -1, name + ' literal is unbalanced');
    return (0, eval)('(' + SRC.slice(open, end) + ')');
}

const talentData = lift('talentData');
const classDataInfo = lift('classDataInfo');

const DEFAULTS = { gatherYield: 1, speedMult: 1.0, bonusHp: 0, forgeAtkMult: 1.0, hasteMod: 1.0,
    vampirism: 0, dmgReducMult: 1.0, thorns: 0, critChance: 0, critMult: 2.0, mpRegenBonus: 1.0, lifeOnKill: 0 };

/** Just enough player for the closures: they only ever touch their own fields. */
function mockPlayer(cls) {
    const p = {
        cls, shopBuffs: { ...DEFAULTS }, buffs: { ...DEFAULTS },
        data: { ...classDataInfo[cls] },
        recalcStats() {}, hasDaySpeed: false,
        resetTalents() {
            this.buffs = { ...this.shopBuffs };
            if (this.hasDaySpeed) this.buffs.speedMult += 1.0;
            this.data = { ...classDataInfo[this.cls] };
        }
    };
    // Talents also set flags the mock does not declare; reading one before it is written
    // should give a number, not undefined, so `+=` behaves the way it does in the game.
    return new Proxy(p, { get: (t, k) => (k in t ? t[k] : 0), set: (t, k, v) => (t[k] = v, true) });
}

const allTalents = cls => talentData[cls].flatMap(path => path.talents).filter(t => t.apply);
const find = id => {
    for (const cls in talentData) {
        const t = allTalents(cls).find(x => x.id === id);
        if (t) return t;
    }
    throw new Error('talent ' + id + ' not found');
};

test('every talent closure takes the player it applies to', () => {
    for (const cls in talentData)
        for (const t of allTalents(cls))
            assert.ok(/^\(r, p\) =>/.test(String(t.apply)),
                cls + '/' + t.id + ' "' + t.name + '" does not take (rank, player)');
});

test('no talent reaches for a global player or a global buff bag', () => {
    for (const cls in talentData)
        for (const t of allTalents(cls)) {
            const src = String(t.apply);
            assert.ok(!/\bplayerBuffs\b/.test(src), cls + '/' + t.id + ' still writes the global buff bag');
            assert.ok(!/\bplayer\b/.test(src), cls + '/' + t.id + ' still reaches for the global player');
        }
});

test('the global buff bag is gone from the game entirely', () => {
    assert.equal(SRC.includes('playerBuffs'), false, 'index.html still mentions playerBuffs');
});

test('every talent applies at every rank without throwing', () => {
    let ranks = 0;
    for (const cls in talentData) {
        const p = mockPlayer(cls);
        for (const t of allTalents(cls))
            for (let r = 1; r <= (t.max || 1); r++) {
                assert.doesNotThrow(() => t.apply(r, p), cls + '/' + t.id + ' rank ' + r + ' threw');
                ranks++;
            }
    }
    assert.ok(ranks >= 140, 'expected the full talent tree, walked only ' + ranks + ' ranks');
});

test('resetTalents takes back everything the talents gave', () => {
    for (const cls in talentData) {
        const p = mockPlayer(cls);
        for (const t of allTalents(cls))
            for (let r = 1; r <= (t.max || 1); r++) t.apply(r, p);
        p.resetTalents();
        assert.deepEqual(p.buffs, DEFAULTS, cls + ': buffs survived a reset');
        assert.deepEqual(p.data, classDataInfo[cls], cls + ': class data survived a reset');
    }
});

test('buy / reset / rebuy does not stack a talent buff', () => {
    const bloodthirst = find('w_b_3');            // +3% vampirism per rank
    const p = mockPlayer('warrior');
    bloodthirst.apply(1, p); bloodthirst.apply(2, p);
    const bought = p.buffs.vampirism;
    assert.ok(bought > 0, 'Bloodthirst did nothing');
    for (let i = 0; i < 6; i++) {
        p.resetTalents();
        assert.equal(p.buffs.vampirism, 0, 'a reset left vampirism behind');
        bloodthirst.apply(1, p); bloodthirst.apply(2, p);
        assert.equal(p.buffs.vampirism, bought, 'rebuy #' + (i + 1) + ' stacked instead of replacing');
    }
});

test('buy / reset / rebuy does not ratchet a cooldown written into class data', () => {
    const fastCast = find('m_p_2');               // Meteor cooldown -1.0s
    const efficiency = find('m_a_3');             // abilities cost 20% less
    const p = mockPlayer('mage');
    const abCd = classDataInfo.mage.abCd, abCost = classDataInfo.mage.abCost;
    for (let i = 0; i < 6; i++) {
        fastCast.apply(1, p); efficiency.apply(1, p);
        p.resetTalents();
        assert.equal(p.data.abCd, abCd, 'reset #' + (i + 1) + ': cooldown ratcheted to ' + p.data.abCd);
        assert.equal(p.data.abCost, abCost, 'reset #' + (i + 1) + ': cost ratcheted to ' + p.data.abCost);
    }
    fastCast.apply(1, p);                          // and it must still actually work
    assert.equal(p.data.abCd, abCd - 1.0, 'Fast Cast stopped working');
});

test('a purchase outlives an Amnesia Potion but a talent does not', () => {
    const bloodthirst = find('w_b_3');
    const p = mockPlayer('warrior');
    p.shopBuffs.vampirism += 0.05; p.buffs.vampirism += 0.05;   // the merchant's ring
    bloodthirst.apply(1, p);
    assert.ok(p.buffs.vampirism > 0.05, 'the talent did not stack on top of the ring');
    p.resetTalents();
    assert.equal(p.buffs.vampirism, 0.05, 'the ring was refunded away with the talents');
});

test('two players do not share a buff bag', () => {
    const a = mockPlayer('warrior'), b = mockPlayer('warrior');
    assert.notEqual(a.buffs, b.buffs);
    assert.notEqual(a.data, b.data);
    find('w_b_3').apply(1, a);
    assert.equal(b.buffs.vampirism, 0, 'one talent reached across to another player');
});

test('resetTalents keeps a boon that is currently running', () => {
    // The day-speed bonus is lent for the day and taken back at dusk. If a reset dropped it,
    // dusk would subtract a bonus nobody had and leave the player permanently slowed.
    const p = mockPlayer('warrior');
    p.hasDaySpeed = true; p.buffs.speedMult += 1.0;
    p.resetTalents();
    assert.equal(p.buffs.speedMult, 2.0, 'the running day-speed boon was lost');
});
