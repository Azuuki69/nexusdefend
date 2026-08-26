// The half of the game a server has to be able to run.
//
// Importing this file at all is most of the test: if src/sim/world.js reached for a document,
// a canvas or an AudioContext, `import` would throw here in plain Node long before any
// assertion ran.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as W from '../src/sim/world.js';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim', 'world.js'), 'utf8');

test('it loads with no browser at all', () => {
    assert.equal(typeof W.world, 'object');
    assert.ok(Object.keys(W).length > 20, 'only ' + Object.keys(W).length + ' exports');
});

test('nothing in it reaches for a browser', () => {
    const code = SRC.replace(/\/\/[^\n]*/g, '');
    for (const forbidden of ['document', 'window', 'canvas', 'audioCtx', 'getElementById',
                             'requestAnimationFrame', 'new Image', 'localStorage'])
        assert.ok(!code.includes(forbidden), 'world.js references ' + forbidden);
});

test('a reset puts the world back to the start of a run', () => {
    W.world.wave = 17;
    W.world.entities.enemies.push({ fake: true });
    W.world.inventory.wood = 999;
    W.resetWorld();
    assert.equal(W.world.wave, 1);
    assert.deepEqual(W.world.entities.enemies, []);
    assert.equal(W.world.inventory.wood, 50);
    assert.equal(W.world.gameState, 'MENU');
});

test('the seeded stream is reproducible and seed-dependent', () => {
    W.seedRun(1234);
    const a = [W.rnd(), W.rnd(), W.rnd()];
    W.seedRun(1234);
    assert.deepEqual([W.rnd(), W.rnd(), W.rnd()], a, 'same seed gave a different stream');
    W.seedRun(5678);
    assert.notDeepEqual([W.rnd(), W.rnd(), W.rnd()], a, 'different seeds gave the same stream');
});

test('the party queries answer sensibly with nobody in the match', () => {
    W.resetWorld();
    assert.deepEqual(W.livingPlayers(), []);
    assert.equal(W.nearestPlayer(0, 0), null);
    assert.equal(W.nearestPlayerDist(0, 0), Infinity);
    assert.deepEqual(W.playersInRange(0, 0, 500), []);
    assert.equal(W.killCredit(), null, 'kill credit with no players should be nobody');
    assert.equal(W.headcount(), 1, 'headcount floors at one so the multipliers never divide by zero');
});

test('the party queries find the right player', () => {
    W.resetWorld();
    const near = { x: 10, y: 0, hp: 100 };
    const far = { x: 900, y: 0, hp: 100 };
    const dead = { x: 1, y: 0, hp: 0 };
    W.world.players.push(near, far, dead);
    assert.equal(W.nearestPlayer(0, 0), near);
    assert.equal(W.nearestPlayer(1000, 0), far);
    assert.deepEqual(W.livingPlayers(), [near, far], 'a downed player is not living');
    assert.equal(W.nearestPlayer(2, 0), near, 'a downed player must not be targeted');
    assert.deepEqual(W.playersInRange(0, 0, 100), [near]);
    assert.equal(W.headcount(), 3);
    W.resetWorld();
});

test('killCredit is the one seam left, and it is honest about it', () => {
    W.resetWorld();
    const a = { x: 0, y: 0, hp: 100 }, b = { x: 5, y: 0, hp: 100 };
    W.world.players.push(a, b);
    assert.equal(W.killCredit(), a, 'credit goes to the first player until damage carries a source');
    W.resetWorld();
});

test('co-op multipliers are exactly 1 for a single player', () => {
    W.resetWorld();
    W.world.players.push({ hp: 100 });
    assert.equal(W.coopEnemyMult(), 1);
    assert.equal(W.coopToughMult(), 1);
    W.world.players.push({ hp: 100 });
    assert.ok(W.coopEnemyMult() > 1 && W.coopEnemyMult() < 2, 'two players should be sub-linear');
    W.resetWorld();
});

test('the presentation sink is silent until something is installed', () => {
    // A server installs nothing. These must not throw and must not need a browser.
    assert.doesNotThrow(() => { W.playSound('hit'); W.spawnParticles(1, 2, '#fff', 3); W.addShake(4); });
});

test('recording turns the same calls into an event log', () => {
    W.setFxMode('record');
    W.playSound('hit');
    W.spawnParticles(10.4, 20.6, '#fff', 3);
    W.addShake(5);
    const log = W.drainFx();
    assert.deepEqual(log, [
        ['sound', 'hit'],
        ['particles', 10, 21, '#fff', 3],   // rounded: this stream is meant to go over a wire
        ['shake', 5]
    ]);
    W.setFxMode('live');
});

test('an installed sink receives the calls', () => {
    const seen = [];
    W.installFx({
        sound: t => seen.push(['sound', t]), particles: () => seen.push(['particles']),
        shake: () => seen.push(['shake']), text: () => seen.push(['text'])
    });
    W.setFxMode('live');
    W.playSound('levelup');
    assert.deepEqual(seen, [['sound', 'levelup']]);
});

test('a headless UI never lets a shop window stop the world', () => {
    W.setUiMode('headless');
    assert.equal(W.ui.modalOpen(), false, 'headless must not pause for a modal');
    W.ui.open('forge');
    assert.deepEqual(W.drainUi(), [['open', 'forge']]);
    W.setUiMode('live');
});

test('geometry works without a canvas', () => {
    assert.equal(W.clampWorld(-50, 1000, 40), 40);
    assert.equal(W.clampWorld(5000, 1000, 40), 960);
    assert.equal(W.clampWorld(500, 1000, 40), 500);
    W.resetWorld();
    assert.equal(W.isCollidingWithObstacle(0, 0, 10), false, 'an empty world collides with nothing');
});

test('a fresh player gets fresh buffs and a fresh intent', () => {
    const a = W.makeBuffs(), b = W.makeBuffs();
    assert.notEqual(a, b);
    assert.equal(a.vampirism, 0);
    assert.equal(a.critMult, 2.0);
    const i = W.makeIntent();
    assert.equal(i.moveX, 0);
    assert.equal(i.attack, false);
    assert.equal(i.seq, 0);
});

test('a shop buff lands on both the live values and the permanent record', () => {
    const p = { buffs: W.makeBuffs(), shopBuffs: W.makeBuffs() };
    W.grantShopBuff(p, 'vampirism', 0.05);
    assert.equal(p.buffs.vampirism, 0.05);
    assert.equal(p.shopBuffs.vampirism, 0.05, 'the purchase would not survive an Amnesia Potion');
    W.grantShopBuff(p, 'hasteMod', 0.8, true);
    assert.equal(p.buffs.hasteMod, 0.8);
    assert.equal(p.shopBuffs.hasteMod, 0.8);
});

// --- co-op survival ----------------------------------------------------------------------
// A run used to end when `player.hp <= 0` - the one global player. In co-op that would end
// everyone's game the moment one person went down. The rule is now "the party is down", which
// is the same sentence when the party is one.

test('livingPlayers is what a co-op run should end on', () => {
    W.resetWorld();
    const a = { hp: 100 }, b = { hp: 100 };
    W.world.players.push(a, b);
    assert.equal(W.livingPlayers().length, 2);
    a.hp = 0;
    assert.equal(W.livingPlayers().length, 1, 'one down is not the end of a co-op run');
    b.hp = 0;
    assert.equal(W.livingPlayers().length, 0, 'the party is down now');
    W.resetWorld();
});
