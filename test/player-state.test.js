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

import * as SIM from '../src/sim/constants.js';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

// The game is two files now: index.html is the client, src/sim/world.js is the half that can
// run on a server. Tests about structure look at both; tests about the markup or the module
// shape still look at index.html alone.
const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD = readFileSync(join(HERE, '..', 'src', 'sim', 'world.js'), 'utf8');
const ENTITIES = readFileSync(join(HERE, '..', 'src', 'sim', 'entities.js'), 'utf8');
const GAME = SRC + WORLD + ENTITIES;

/** Lift a top-level `const NAME = {...};` literal out of the game and evaluate it. */
function lift(name) {
    // The literals live in index.html or in one of the sim modules now, so look in all of
    // them rather than assuming which file a given table ended up in.
    for (const text of [SRC, ENTITIES, WORLD]) {
        const start = text.indexOf('const ' + name + ' = {');
        if (start === -1) continue;
        const open = text.indexOf('{', start);
        let depth = 0;
        for (let i = open; i < text.length; i++) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}' && --depth === 0)
                return (0, eval)('(' + text.slice(open, i + 1) + ')');
        }
        assert.fail(name + ' literal is unbalanced');
    }
    assert.fail(name + ' not found in index.html, entities.js or world.js');
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

/** Channel names offered by an object literal, whether written `x:` or `x() {}`. */
/** Comments stripped. `[^\n]*` rather than `.*`: these files are CRLF, and in JavaScript
 *  `.` does not match \r because \r is a line terminator - so `//.*$` strips nothing. */
function noComments(text) { return text.replace(/\/\/[^\n]*/g, ''); }

function channelsOf(text) {
    // A channel name is an identifier in KEY POSITION: at depth 1 inside the literal, followed
    // by `:` or `(`, and preceded by `{` or `,`. Depth alone is not enough - an arrow-bodied
    // handler like `open: name => uiLog.push(...)` keeps the same depth, so `push` looked like
    // a key. This is the same test that a rename needs, for the same reason.
    const names = new Set();
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '{' || c === '(' || c === '[') { depth++; continue; }
        if (c === '}' || c === ')' || c === ']') { depth--; continue; }
        if (depth !== 1) continue;
        const m = /^([A-Za-z_$][\w$]*)\s*[:(]/.exec(text.slice(i));
        if (!m) continue;
        let k = i - 1;
        while (k >= 0 && /\s/.test(text[k])) k--;
        if (k >= 0 && (text[k] === '{' || text[k] === ',')) names.add(m[1]);
        i += m[1].length - 1;
    }
    return [...names].sort();
}

/** The body of `const NAME = {...}` wherever it lives, by brace depth. */
function literal(rawText, decl) {
    const text = noComments(rawText);
    const start = text.indexOf(decl);
    if (start < 0) return '';
    const open = text.indexOf('{', start);
    let d = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '{') d++;
        else if (text[i] === '}' && --d === 0) return text.slice(open, i + 1);
    }
    return '';
}

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
    for (const decl of ['const fxNull = {', 'const fxRecord = {', 'export let fx = fxNull;'])
        assert.ok(WORLD.includes(decl), 'missing from world.js: ' + decl);
    assert.ok(GAME.includes('const fxLive = {'), 'the client has no live sink to install');
    assert.ok(GAME.includes('installFx(fxLive);'), 'the client never installs its sink');

    // All three must agree, or a mode switch hits an undefined channel.
    const wanted = ['particles', 'shake', 'sound', 'text'];
    for (const [what, text] of [['fxNull', literal(WORLD, 'const fxNull = {')],
                                ['fxRecord', literal(WORLD, 'const fxRecord = {')],
                                ['fxLive', literal(GAME, 'const fxLive = {')]]) {
        assert.deepEqual(channelsOf(text), wanted, what + ' offers the wrong channels');
    }
});

test('the dispatchers go through the sink, never straight to the implementation', () => {
    for (const [dispatch, channel] of [
        ['function playSound(type) {', 'fx.sound(type);'],
        ['function spawnParticles(x, y, color, count) {', 'fx.particles(x, y, color, count);'],
        ['function addShake(amt) {', 'fx.shake(amt);'],
    ]) {
        const i = GAME.indexOf(dispatch);
        assert.notEqual(i, -1, 'missing dispatcher: ' + dispatch);
        assert.ok(GAME.slice(i, i + 160).includes(channel), dispatch + ' does not call ' + channel);
    }
});

test('nothing bypasses the sink by calling the raw implementation', () => {
    // The `...Now` functions are the real audio and canvas work. Only fxLive may call them;
    // everything else goes through playSound / spawnParticles / addShake so that a server can
    // swap the destination.
    const live = literal(GAME, 'const fxLive = {');
    for (const raw of ['playSoundNow(', 'spawnParticlesNow(', 'addShakeNow(']) {
        const total = GAME.split(raw).length - 1;
        const inLive = live.split(raw).length - 1;
        const declared = GAME.includes('function ' + raw) ? 1 : 0;
        const stray = total - inLive - declared;
        assert.equal(stray, 0, raw + ' is called ' + stray + ' time(s) outside the sink');
    }
    // and world.js must not reach for them at all - it has no audio to reach for
    for (const raw of ['playSoundNow', 'spawnParticlesNow', 'addShakeNow', 'audioCtx'])
        assert.ok(!WORLD.includes(raw), 'world.js references ' + raw);
});

test('FloatingText announces itself so a headless run sees the same words', () => {
    const i = GAME.indexOf('class FloatingText {');
    assert.notEqual(i, -1);
    assert.ok(GAME.slice(i, i + 320).includes('fx.text(x, y, text, color)'),
        'FloatingText does not report through the sink');
});

test('the sim classes still have their juice - the sink did not strip it', () => {
    // If a refactor ever quietly removed these calls the determinism test would still pass
    // while the game went silent, so the count is worth pinning down.
    const calls = ['playSound(', 'new FloatingText(', 'spawnParticles(', 'addShake('];
    const total = calls.reduce((n, c) => n + GAME.split(c).length - 1, 0);
    assert.ok(total > 180, 'presentation calls dropped to ' + total + '; something stripped them');
});

// --- co-op scaling -----------------------------------------------------------------------
// `count = wave * 2 + 6` was written for one player. The rule that matters most here is that
// every multiplier is exactly 1.0 at a single player, so solo play is untouched - that is what
// lets the scaling land without re-balancing the game anyone is actually playing.

// These used to be scraped out of index.html. They now live in src/sim/constants.js, so read
// them from there - the module is the single definition and the game imports the same values.
const ENEMY_STEP = SIM.COOP_ENEMY_STEP;
const TOUGH_STEP = SIM.COOP_TOUGH_STEP;
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
    assert.ok(/let count = Math\.round\(\(world\.wave \* 2 \+ 6\) \* coopEnemyMult\(\)\)/.test(GAME),
        'the wave count does not scale');
    assert.ok(/NEXUS_HP_GROWTH, w - 1\) \* coopToughMult\(\)/.test(GAME),
        'the Nexus does not harden with the party');
    assert.ok(/this\.hp = Math\.floor\(this\.hp \* coopToughMult\(\)\);/.test(GAME),
        'the boss does not scale');
});

test('the boss is scaled before maxHp is taken from hp', () => {
    // Otherwise the health bar reads over 100% and only appears once the boss is nearly dead.
    const scale = GAME.indexOf('this.hp = Math.floor(this.hp * coopToughMult());');
    const sync = GAME.indexOf('this.maxHp = this.hp;', scale);
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
    const lines = GAME.split('\n');
    // Strip the CR first. The file is CRLF, and in JavaScript `.` does not match \r - it is a
    // line terminator - so /\/\/.*$/ matches nothing at all on a CRLF line and the comment
    // survives. Python's `.` does match \r, which is why the analysis scripts never saw this.
    const clean = lines.map(l => l.replace(/\r/g, '').replace(/\/\/.*$/, '')
                                  .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""'));
    lines.forEach((l, i) => {
        const m = l.match(/^\s*(?:export )?function (\w+)\(/);
        if (!m) return;
        let d = 0;
        for (let j = i; j < Math.min(i + 400, lines.length); j++) {
            d += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
            if (j > i && d <= 0) { funcs[m[1]] = [i, j]; break; }
        }
    });
    const body = f => clean.slice(funcs[f][0], funcs[f][1] + 1).join('\n');
    const seen = new Set(), q = ['stepWorld'];
    while (q.length) {
        const f = q.shift();
        if (seen.has(f) || !funcs[f]) continue;
        seen.add(f);
        for (const [, c] of body(f).matchAll(/\b(\w+)\s*\(/g)) if (funcs[c] && c !== f) q.push(c);
    }
    return { seen, body, funcs };
}

test('nothing the tick can reach touches the DOM', () => {
    const { seen, body, funcs } = reachableFromUpdate();
    const offenders = [...seen]
        .filter(f => funcs[f] && body(f).includes('document.'))
        .map(f => f + ' (line ' + (funcs[f][0] + 1) + ')');
    assert.deepEqual(offenders, [],
        'the simulation can still reach the DOM through: ' + offenders.join(', '));
    assert.ok(seen.size > 20, 'the call graph walk found only ' + seen.size + ' functions; it is not working');
});

test('the UI sink exists with matching channels on both sides', () => {
    const nul = literal(WORLD, 'const uiNull = {');
    const head = literal(WORLD, 'const uiHeadless = {');
    const live = literal(GAME, 'const uiLive = {');
    assert.ok(nul && head && live, 'one of the three UI sinks is missing');
    assert.deepEqual(channelsOf(head), channelsOf(nul),
        'uiHeadless and uiNull disagree, so a mode switch hits an undefined');
    assert.deepEqual(channelsOf(live), channelsOf(nul),
        'the client sink and the module sink disagree');
    assert.ok(GAME.includes('installUi(uiLive);'), 'the client never installs its UI sink');
});

test('headless keeps the world running while somebody shops', () => {
    // The whole simulation used to stop while a modal was open. Alone that is a pause; in
    // co-op it would freeze everyone else because one player opened the forge.
    const head = GAME.slice(GAME.indexOf('const uiHeadless = {'), GAME.indexOf('let ui = uiLive;'));
    assert.ok(/modalOpen:\s*\(\)\s*=>\s*false/.test(head),
        'the headless sink still lets a modal halt the world');
    const live = GAME.slice(GAME.indexOf('const uiLive = {'), GAME.indexOf('let uiLog'));
    assert.ok(/modalOpen:\s*\(\)\s*=>\s*anyModalOpenNow\(\)/.test(live),
        'the live sink no longer pauses, which changes single player');
});

test('the client asks the sink, never the document, whether a modal is open', () => {
    assert.ok(GAME.includes('if (isPaused || ui.modalOpen()) { ui.hud(); return; }'),
        'the game loop does not gate on the sink');
    // anyModalOpenNow is the implementation; only uiLive may call it.
    const outside = GAME.split('anyModalOpenNow(').length - 1 - 1 /* declaration */;
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
    assert.ok(/while \(simAccumulator >= SIM_DT\) \{/.test(loop),
        'the loop does not step a fixed accumulator');
    assert.ok(/if \(handleLocalIntents\(SIM_DT\)\) stepWorld\(SIM_DT\);/.test(loop),
        'the loop does not run the client half then the world half in fixed steps');
    assert.ok(!/stepWorld\(dt\)/.test(loop), 'the loop still hands the tick a raw frame delta');
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

// --- the module conversion ---------------------------------------------------------------
// The game had to become a module before it could import from src/sim/. Two things that
// conversion can silently break, both pinned here.

test('the game is a module and there is no classic script left', () => {
    assert.ok(/<script type="module">/.test(SRC), 'the game script is not a module');
    assert.ok(/import \{[\s\S]*?\} from '\.\/src\/sim\/world\.js';/.test(SRC),
        'index.html does not import the simulation');
    const classic = SRC.match(/<script(?![^>]*type=)[^>]*>/g) || [];
    assert.deepEqual(classic, [], 'a classic script survived: ' + classic.join(', '));
});

test('every inline handler in the markup has a name bridged onto window', () => {
    // Module scope is not global scope. An onclick the bridge forgets is a dead button, and
    // nothing throws until somebody clicks it.
    const used = new Set();
    for (const m of SRC.matchAll(/\bon(?:click|input|change)="([^"]*)"/g)) {
        const fn = m[1].match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
        if (fn) used.add(fn[1]);
    }
    assert.ok(used.size >= 15, 'only found ' + used.size + ' inline handlers; the scan is wrong');
    const bridge = SRC.slice(SRC.indexOf('Object.assign(window, {'));
    const bridged = new Set((bridge.slice(0, bridge.indexOf('}')).match(/[A-Za-z_$][\w$]*/g) || []));
    const missing = [...used].filter(n => !bridged.has(n));
    assert.deepEqual(missing, [], 'inline handlers with no bridge: ' + missing.join(', '));
});

test('the markup the game needs is still there', () => {
    // A bad anchor in a scripted edit once deleted the pause overlay and the whole HUD.
    for (const id of ['hud', 'mainMenu', 'pauseOverlay', 'forgeOverlay', 'merchantOverlay',
                      'campOverlay', 'talentOverlay', 'buildingsOverlay', 'gameOverOverlay',
                      'phaseText', 'weatherText', 'ui-wave', 'musicVol', 'sfxVol'])
        assert.ok(SRC.includes('id="' + id + '"'), 'missing element: #' + id);
});

test('the test handle exists and the game does not read it', () => {
    assert.ok(SRC.includes('window.__nexus = {'), 'the replay harness has no way in');
    // it is a door for tests, not a back channel for the game
    const uses = SRC.split('__nexus').length - 1;
    assert.equal(uses, 1, '__nexus is referenced ' + uses + ' times; the game should never read it');
});

// --- input as data -----------------------------------------------------------------------
// The simulation read `keys` and `mouse` directly. A server has neither, and in co-op every
// player has their own, so the simulation takes an intent instead: what one player wants this
// tick, already resolved from whatever device produced it.

test('no simulation code reads the keyboard or the mouse', () => {
    const lines = SRC.split('\n');
    // Strip the CR first. The file is CRLF, and in JavaScript `.` does not match \r - it is a
    // line terminator - so /\/\/.*$/ matches nothing at all on a CRLF line and the comment
    // survives. Python's `.` does match \r, which is why the analysis scripts never saw this.
    const clean = lines.map(l => l.replace(/\r/g, '').replace(/\/\/.*$/, '')
                                  .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""'));
    const marks = [];
    lines.forEach((l, i) => {
        const m = l.match(/^\s*(?:class|function)\s+(\w+)/);
        if (m) marks.push([i, m[1]]);
    });
    const region = i => {
        let r = '(top)';
        for (const [ln, nm] of marks) { if (ln <= i) r = nm; else break; }
        return r;
    };
    const SIM = new Set(['Player', 'Enemy', 'Entity', 'Projectile', 'Critter', 'Base', 'update',
        'spawnWave', 'Wanderer', 'Merchant', 'Item', 'Effect', 'Resource', 'Extractor',
        'Obstacle', 'Particle', 'FloatingText']);
    const offenders = [];
    clean.forEach((l, i) => {
        if (/\b(keys|mouse)\b/.test(l) && SIM.has(region(i)))
            offenders.push(region(i) + ':' + (i + 1) + ' ' + lines[i].trim().slice(0, 60));
    });
    assert.deepEqual(offenders, [], 'simulation still reads raw input:\n  ' + offenders.join('\n  '));
});

test('an intent carries everything the simulation needs from a player', () => {
    const i = GAME.indexOf('function makeIntent()');
    assert.notEqual(i, -1, 'makeIntent is gone');
    const body = GAME.slice(i, GAME.indexOf('}', GAME.indexOf('return {', i)));
    for (const field of ['moveX', 'moveY', 'aimX', 'aimY', 'attack', 'place', 'dash',
                         'ability', 'overcharge', 'interact', 'openTalents', 'openBuildings', 'seq'])
        assert.ok(body.includes(field + ':'), 'intent has no ' + field);
    // aim must be world coordinates - the camera is the client's business
    assert.ok(/aimX: 0, aimY: 0/.test(body));
});

test('every player gets their own intent', () => {
    assert.ok(/this\.intent = makeIntent\(\);/.test(GAME),
        'the Player constructor does not create an intent');
});

test('input is read once per frame, not once per simulation step', () => {
    // Two steps in one frame must not see two presses of the same key.
    const loop = SRC.slice(SRC.indexOf('function gameLoop(timestamp)'));
    const read = loop.indexOf('readLocalIntent(player);');
    const stepLoop = loop.indexOf('while (simAccumulator >= SIM_DT)');
    assert.ok(read !== -1 && stepLoop !== -1, 'the loop is not shaped as expected');
    assert.ok(read < stepLoop, 'readLocalIntent runs inside the step loop');
});

test('held and edge-triggered actions are produced differently', () => {
    const i = GAME.indexOf('function readLocalIntent(p)');
    const body = GAME.slice(i, i + 1400);
    // edge actions go through the edge helper
    for (const a of ['ability', 'overcharge', 'interact', 'openTalents', 'openBuildings'])
        assert.ok(body.includes('i.' + a + ' = edge('), a + ' is not edge-triggered');
    // held actions read the device state directly
    assert.ok(/i\.dash = !!keys\['shift'\]/.test(body), 'dash should be held, not edged');
    // and the two spend-latches exist, or a click on an NPC would also swing
    assert.ok(/if \(!mouse\.clicked\) i\.attackSpent = false;/.test(body), 'no attack spend-latch');
    assert.ok(/if \(!mouse\.rightClicked\) i\.placeSpent = false;/.test(body), 'no place spend-latch');
});
