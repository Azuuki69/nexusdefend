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

// --- the presentation sink ---------------------------------------------------------------
// Simulation code cannot run on a server while it is calling into an AudioContext and a
// canvas. Rather than rewrite ~80 call sites into an event queue, the four entry points
// dispatch through a swappable sink: the browser installs the real one, a headless run
// installs a recorder. These guard the property that makes that work - that nothing reaches
// past the sink to the implementation underneath.

test('the presentation sink exists with all four channels', () => {
    for (const decl of ['const fxLive = {', 'const fxRecord = {', 'let fx = fxLive;'])
        assert.ok(SRC.includes(decl), 'missing: ' + decl);
    for (const channel of ['sound:', 'particles:', 'shake:', 'text:']) {
        const live = SRC.slice(SRC.indexOf('const fxLive = {'), SRC.indexOf('let fxLog'));
        const rec = SRC.slice(SRC.indexOf('const fxRecord = {'), SRC.indexOf('let fx = fxLive;'));
        assert.ok(live.includes(channel), 'fxLive has no ' + channel);
        assert.ok(rec.includes(channel), 'fxRecord has no ' + channel);
    }
});

test('the dispatchers go through the sink, never straight to the implementation', () => {
    for (const [dispatch, channel] of [
        ['function playSound(type) {', 'fx.sound(type);'],
        ['function spawnParticles(x, y, color, count) {', 'fx.particles(x, y, color, count);'],
        ['function addShake(amt) {', 'fx.shake(amt);'],
    ]) {
        const i = SRC.indexOf(dispatch);
        assert.notEqual(i, -1, 'missing dispatcher: ' + dispatch);
        assert.ok(SRC.slice(i, i + 160).includes(channel), dispatch + ' does not call ' + channel);
    }
});

test('nothing bypasses the sink by calling the raw implementation', () => {
    // fxLive is allowed to - that is its entire job. Nobody else may.
    const live = SRC.slice(SRC.indexOf('const fxLive = {'), SRC.indexOf('let fxLog'));
    for (const raw of ['playSoundNow(', 'spawnParticlesNow(', 'addShakeNow(']) {
        const total = SRC.split(raw).length - 1;
        const inLive = live.split(raw).length - 1;
        const declared = SRC.includes('function ' + raw) ? 1 : 0;
        assert.equal(total - inLive - declared, 0,
            raw + ' is called ' + (total - inLive - declared) + ' time(s) outside the sink');
    }
});

test('FloatingText announces itself so a headless run sees the same words', () => {
    const i = SRC.indexOf('class FloatingText {');
    assert.notEqual(i, -1);
    assert.ok(SRC.slice(i, i + 320).includes('fx.text(x, y, text, color)'),
        'FloatingText does not report through the sink');
});

test('the sim classes still have their juice - the sink did not strip it', () => {
    // If a refactor ever quietly removed these calls the determinism test would still pass
    // while the game went silent, so the count is worth pinning down.
    const calls = ['playSound(', 'new FloatingText(', 'spawnParticles(', 'addShake('];
    const total = calls.reduce((n, c) => n + SRC.split(c).length - 1, 0);
    assert.ok(total > 180, 'presentation calls dropped to ' + total + '; something stripped them');
});

// --- co-op scaling -----------------------------------------------------------------------
// `count = wave * 2 + 6` was written for one player. The rule that matters most here is that
// every multiplier is exactly 1.0 at a single player, so solo play is untouched - that is what
// lets the scaling land without re-balancing the game anyone is actually playing.

/** Pull a `const NAME = value;` number out of the game. */
function liftNumber(name) {
    const m = SRC.match(new RegExp('const ' + name + ' = ([0-9.]+);'));
    assert.ok(m, name + ' not found in index.html');
    return parseFloat(m[1]);
}

const ENEMY_STEP = liftNumber('COOP_ENEMY_STEP');
const TOUGH_STEP = liftNumber('COOP_TOUGH_STEP');
const enemyMult = n => 1 + ENEMY_STEP * (Math.max(1, n) - 1);
const toughMult = n => 1 + TOUGH_STEP * (Math.max(1, n) - 1);

test('a single player scales nothing at all', () => {
    assert.equal(enemyMult(1), 1, 'solo enemy count would change');
    assert.equal(toughMult(1), 1, 'solo boss and Nexus health would change');
    assert.equal(enemyMult(0), 1, 'an empty party must not divide by anything');
});

test('the horde grows with the party but not in proportion to it', () => {
    for (let n = 2; n <= 4; n++) {
        assert.ok(enemyMult(n) > enemyMult(n - 1), n + ' players faced no more than ' + (n - 1));
        assert.ok(enemyMult(n) < n, n + ' players face ' + enemyMult(n) + 'x, which is not sub-linear');
    }
});

test('bosses take health rather than company, on the gentler curve', () => {
    // There is only ever one boss, so it cannot scale by count the way trash does - but it
    // must not out-scale the trash either, or a party spends the whole wave on one health bar.
    assert.ok(TOUGH_STEP < ENEMY_STEP, 'boss health scales faster than the horde does');
    for (let n = 2; n <= 4; n++) assert.ok(toughMult(n) > 1);
});

test('the scaling is actually wired into the three places that matter', () => {
    assert.ok(/let count = Math\.round\(\(wave \* 2 \+ 6\) \* coopEnemyMult\(\)\)/.test(SRC),
        'the wave count does not scale');
    assert.ok(/NEXUS_HP_GROWTH, w - 1\) \* coopToughMult\(\)/.test(SRC),
        'the Nexus does not harden with the party');
    assert.ok(/this\.hp = Math\.floor\(this\.hp \* coopToughMult\(\)\);/.test(SRC),
        'the boss does not scale');
});

test('the boss is scaled before maxHp is taken from hp', () => {
    // Otherwise the health bar reads over 100% and only appears once the boss is nearly dead.
    const scale = SRC.indexOf('this.hp = Math.floor(this.hp * coopToughMult());');
    const sync = SRC.indexOf('this.maxHp = this.hp;', scale);
    assert.ok(scale !== -1 && sync !== -1 && scale < sync,
        'boss scaling happens after maxHp is captured');
});

// --- the UI sink -------------------------------------------------------------------------
// update() used to reach 18 DOM-touching functions, 60 getElementById calls deep. A Durable
// Object has no document. Same sink pattern as the presentation layer: uiLive drives the real
// windows, uiHeadless records and answers `modalOpen` with false.

/** Everything update() can reach, by walking the call graph the way the game does. */
function reachableFromUpdate() {
    const funcs = {};
    const lines = SRC.split('\n');
    const clean = lines.map(l => l.replace(/\/\/.*$/, '').replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""'));
    lines.forEach((l, i) => {
        const m = l.match(/^\s*function (\w+)\(/);
        if (!m) return;
        let d = 0;
        for (let j = i; j < Math.min(i + 400, lines.length); j++) {
            d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
            if (j > i && d <= 0) { funcs[m[1]] = [i, j]; break; }
        }
    });
    const body = f => clean.slice(funcs[f][0], funcs[f][1] + 1).join('\n');
    const seen = new Set(), q = ['update'];
    while (q.length) {
        const f = q.shift();
        if (seen.has(f) || !funcs[f]) continue;
        seen.add(f);
        for (const [, c] of body(f).matchAll(/\b(\w+)\s*\(/g)) if (funcs[c] && c !== f) q.push(c);
    }
    return { seen, body, funcs };
}

test('nothing update() can reach touches the DOM', () => {
    const { seen, body, funcs } = reachableFromUpdate();
    const offenders = [...seen]
        .filter(f => funcs[f] && body(f).includes('document.'))
        .map(f => f + ' (line ' + (funcs[f][0] + 1) + ')');
    assert.deepEqual(offenders, [],
        'the simulation can still reach the DOM through: ' + offenders.join(', '));
    assert.ok(seen.size > 20, 'the call graph walk found only ' + seen.size + ' functions; it is not working');
});

test('the UI sink exists with matching channels on both sides', () => {
    const live = SRC.slice(SRC.indexOf('const uiLive = {'), SRC.indexOf('let uiLog'));
    const head = SRC.slice(SRC.indexOf('const uiHeadless = {'), SRC.indexOf('let ui = uiLive;'));
    assert.ok(live.length > 40 && head.length > 40, 'one of the sinks is missing');
    const channels = s => [...s.matchAll(/^\s{8}(\w+):/gm)].map(m => m[1]).sort();
    assert.deepEqual(channels(live), channels(head),
        'the two sinks do not offer the same channels, so headless will hit an undefined');
});

test('headless keeps the world running while somebody shops', () => {
    // The whole simulation used to stop while a modal was open. Alone that is a pause; in
    // co-op it would freeze everyone else because one player opened the forge.
    const head = SRC.slice(SRC.indexOf('const uiHeadless = {'), SRC.indexOf('let ui = uiLive;'));
    assert.ok(/modalOpen:\s*\(\)\s*=>\s*false/.test(head),
        'the headless sink still lets a modal halt the world');
    const live = SRC.slice(SRC.indexOf('const uiLive = {'), SRC.indexOf('let uiLog'));
    assert.ok(/modalOpen:\s*\(\)\s*=>\s*anyModalOpenNow\(\)/.test(live),
        'the live sink no longer pauses, which changes single player');
});

test('update() asks the sink, never the document, whether a modal is open', () => {
    assert.ok(SRC.includes('if (isPaused || ui.modalOpen()) { ui.hud(); return; }'),
        'the game loop does not gate on the sink');
    // anyModalOpenNow is the implementation; only uiLive may call it.
    const outside = SRC.split('anyModalOpenNow(').length - 1 - 1 /* declaration */;
    assert.equal(outside, 1, 'anyModalOpenNow is called ' + outside + ' times; only uiLive should');
});

// --- fixed timestep ----------------------------------------------------------------------
// The game was written for 60fps: `dt * 60` is used throughout as "one frame's worth", and a
// few terms (particle damping, `vx *= 0.9`) are not scaled by dt at all. Under a variable dt
// that means a 144Hz monitor and a 60Hz one ran measurably different physics, and a server
// could reproduce neither. The loop now advances in whole fixed steps.

test('the loop advances in whole fixed steps, never a raw frame delta', () => {
    const i = SRC.indexOf('function gameLoop(timestamp)');
    assert.notEqual(i, -1, 'gameLoop is gone');
    const loop = SRC.slice(i, i + 900);
    assert.ok(/while \(simAccumulator >= SIM_DT\) \{ update\(SIM_DT\);/.test(loop),
        'the loop does not step a fixed accumulator');
    assert.ok(!/update\(dt\)/.test(loop), 'the loop still hands update() a raw frame delta');
});

test('a stall cannot spiral into hundreds of catch-up steps', () => {
    const i = SRC.indexOf('function gameLoop(timestamp)');
    const loop = SRC.slice(i, i + 900);
    assert.ok(/if \(elapsed > MAX_CATCHUP\) elapsed = MAX_CATCHUP;/.test(loop),
        'a backgrounded tab would try to make up the whole gap in one frame');
    assert.ok(/if \(!\(elapsed > 0\)\) elapsed = 0;/.test(loop),
        'a negative or NaN timestamp would run the simulation backwards');
    const cap = SRC.match(/const MAX_CATCHUP = ([0-9.]+);/);
    assert.ok(cap && parseFloat(cap[1]) > 0 && parseFloat(cap[1]) <= 1,
        'MAX_CATCHUP is missing or not a sane fraction of a second');
});

test('the accumulator is reset when a run starts', () => {
    // Otherwise the leftover from the previous run is spent as extra steps on frame one.
    assert.ok(/lastTime = performance\.now\(\); simAccumulator = 0;/.test(SRC),
        'startGame does not clear the accumulator');
});

test('the simulation rate is a named constant the server can differ from', () => {
    const hz = SRC.match(/const SIM_HZ = (\d+);/);
    assert.ok(hz, 'SIM_HZ is not declared');
    assert.equal(parseInt(hz[1], 10), 60, 'the client rate moved; check the game still feels right');
    assert.ok(/const SIM_DT = 1 \/ SIM_HZ;/.test(SRC), 'SIM_DT is not derived from SIM_HZ');
});
