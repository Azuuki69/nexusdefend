// The world, and the rules that do not need a screen.
//
// Everything here can run in a Durable Object: no DOM, no canvas, no audio, no camera. That is
// the whole point of the file - it is the half of the game a server has to be able to execute.
//
// Two things are deliberately NOT here. The live presentation sink is an AudioContext and a
// canvas, and the live UI sink is a pile of getElementById; the client installs both through
// installFx / installUi. A server installs nothing and gets the recording sinks instead, which
// turn the same calls into an event log.

import {
    WORLD_W, WORLD_H, WORLD_CX, WORLD_CY, POND_CX, POND_CY, POND_RX, POND_RY,
    NEXUS_BASE_HP, NEXUS_HP_GROWTH, COOP_ENEMY_STEP, COOP_TOUGH_STEP
} from './constants.js';
import { mulberry32, randomSeed } from './rng.js';

// --- The world ----------------------------------------------------------------
// Everything a match *is*, gathered into one object.
//
// This is not tidiness. A Durable Object isolate can hold several matches at once, and
// anything left at module scope is shared between them - two matches would fight over one
// set of enemies. Per-match state has to hang off something per-match, so it moves here
// one binding at a time, each move checked against a recorded replay digest.
//
// Deliberately NOT in here: cam, ui, fx, audioSettings, screenShake, isPaused,
// placingBuilding and simAccumulator. Those describe this client's *view* of a match
// rather than the match itself, and a server has no business owning them.
export const world = {};

/** Put the world back to how a run starts. Called by startGame and by a restart. */
export function resetWorld() {
    world.currentSeed = 0;
    world.activeQuest = null;
    world.forgeBuilding = null;
    world.gameState = 'MENU';
    world.base = null;
    world.players = [];
    world.entities = { enemies: [], extractors: [], projectiles: [], resources: [], effects: [], texts: [], particles: [], items: [], obstacles: [], npcs: [], critters: [], decorations: [], solids: [] };
    world.inventory = { wood: 50, stone: 50, mana: 20 };
    world.wave = 1; world.phaseTimer = 60; world.totalKills = 0;
    world.currentWeather = 'clear';
    world.currentModifier = 'none';
    world.waveDirection = -1; // 0=Top, 1=Bottom, 2=Left, 3=Right
    world.lastBearWave = -99;
    world.lastVisitorWave = { cyclop: -99, troll: -99, orcrider: -99 };
    world.campUpgrades = { jerkin: { level: 0 }, haft: { level: 0 }, stride: { level: 0 } };
    world.campOneOffs = { skinning: false, beastcall: false };
    world.campRationsDay = -1;
    world.gameStats = { dmg: 0, kills: 0, wood: 0, stone: 0, extractors: 0 };
    world.forgeUpgrades = { weapon: { level: 0 }, mining: { level: 0 }, speed: { level: 0 }, nexus: { level: 0 }, whetstone: { level: 0 } };
}
resetWorld();

// --- Seeded randomness ---------------------------------------------------------------
let simRng = null;

export function rnd() { return simRng ? simRng() : Math.random(); }
export function seedRun(seed) {
    world.currentSeed = (seed !== undefined && seed !== null)
        ? (seed >>> 0)
        : randomSeed();
    simRng = mulberry32(world.currentSeed);
    return world.currentSeed;
}

// --- The party ------------------------------------------------------------------------
export function livingPlayers() { return world.players.filter(p => p.hp > 0); }
// Who gets the experience, the lifesteal and the loot for a kill.
//
// takeDamage cannot answer this yet: its `attacker` argument is the enemy that hit you, not
// the player who hit it. Until damage carries the player who dealt it, credit goes to the
// first player in the match - correct while there is only one, and wrong in co-op. This is
// deliberately the only place that assumption lives, so there is one thing to fix.
//
// It used to return the client's `player` global. In a module there is no such thing, and
// there is no "this client" on a server either - which is the honest version of the same
// answer, because world.players[0] IS that player in a single-player run.
export function killCredit() { return world.players[0] || null; }
export function nearestPlayer(x, y) {
    let best = null, bestD = Infinity;
    for (const p of world.players) {
        if (p.hp <= 0) continue;
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = p; }
    }
    // Never null while anyone is in the match. The horde has to have something to walk
    // at, and a party that is entirely down ends the run anyway.
    return best || world.players[0] || null;
}
export function nearestPlayerDist(x, y) {
    const p = nearestPlayer(x, y);
    return p ? Math.hypot(p.x - x, p.y - y) : Infinity;
}
export function playersInRange(x, y, r) {
    return world.players.filter(p => p.hp > 0 && Math.hypot(p.x - x, p.y - y) < r);
}
// The bear was a 300 resource lump sum - about sixty gathering actions from one kill.
// Scaling it keeps the fight worth taking late without being a night-one jackpot.
// A flat 500hp nexus died in about 1.3s at wave 10 and 0.3s at wave 20, so losing was a
// tripwire rather than attrition. Growing the pool with the wave gives leakage somewhere
// to land, which is what makes repairs and the brazier worth having.
// The nexus is the whole failure condition now: towers used to intercept whatever walked
// past you, and nothing does, so anything you cannot personally reach lands on it.
//
// It used to gain a flat 60 HP a wave while enemy damage climbed 1.1x a wave. Geometric
// beats linear, so the number of leakers it could survive fell every night - by wave 20 a
// single enemy chewing on it for the night was lethal, and no amount of flat HP fixes that
// shape. It now compounds at 1.09 against their 1.10, so it very slowly loses ground
// instead of falling off a cliff, and the late game stays playable.
// --- Co-op scaling -----------------------------------------------------------
// `count = wave * 2 + 6` was written for one player. Four of them would walk it.
//
// Two players are not twice as hard to kill as one: they cover each other, they hold two
// lanes, and their cooldowns overlap. So the horde grows by 0.6 a head rather than 1.0,
// and the party still feels stronger together than apart - which is the point of co-op.
//
// Bosses take the gentler curve, and take it as health rather than as numbers, because
// there is only ever one of them and four players delete it in seconds otherwise. The
// Nexus hardens on the same curve: more attackers reach it, so it has to hold longer.
//
// Every one of these is exactly 1.0 at a single player, so solo play is untouched.
export function headcount() { return Math.max(1, world.players.length); }
export function coopEnemyMult() { return 1 + COOP_ENEMY_STEP * (headcount() - 1); }
export function coopToughMult() { return 1 + COOP_TOUGH_STEP * (headcount() - 1); }
export function nexusMaxHpFor(w) { return Math.floor(NEXUS_BASE_HP * Math.pow(NEXUS_HP_GROWTH, w - 1) * coopToughMult()) + 100 * (world.forgeUpgrades.nexus ? world.forgeUpgrades.nexus.level : 0); }

// --- Per-player state ------------------------------------------------------------------
// `vampirism` is the fraction of damage dealt that comes back as health, not a flag: the
// ring and the warrior's Bloodthirst both feed it, and as a boolean the talent's second
// rank bought nothing and the tooltip's 3% was really the ring's 5%.
// Buffs belong to a player, not to the match. Two players in one co-op run have their own
// talents, their own trinkets and their own forge purchases, so vampirism, crit and thorns
// cannot live in a single global the way they used to.
//
// Each player carries two of these:
//   shopBuffs - what was *bought* (forge, camp, merchant, caches). Permanent.
//   buffs     - the live values: shopBuffs plus every talent rank on top.
//
// Splitting them is what makes an Amnesia Potion honest. resetTalents rebuilds `buffs` from
// `shopBuffs`, so talent contributions vanish and purchases survive. Before this, talents
// wrote into the global and nothing ever took them back out: buy Bloodthirst, reset, rebuy,
// and the vampirism stacked forever.
export function makeBuffs(from) {
    return from ? Object.assign({}, from)
                : { gatherYield: 1, speedMult: 1.0, bonusHp: 0, forgeAtkMult: 1.0, hasteMod: 1.0, vampirism: 0,
        dmgReducMult: 1.0, thorns: 0, critChance: 0, critMult: 2.0, mpRegenBonus: 1.0, lifeOnKill: 0 };
}
// A purchase writes to both, so it is still there after the next reset.
export function grantShopBuff(p, field, amount, multiply = false) {
    if (!p) return;
    if (multiply) { p.shopBuffs[field] *= amount; p.buffs[field] *= amount; }
    else          { p.shopBuffs[field] += amount; p.buffs[field] += amount; }
}
// --- Input as data -------------------------------------------------------------
// The simulation used to read the keyboard and the mouse directly. A server has neither,
// and in co-op every player has their own - so what the simulation gets instead is an
// intent: what one player wants this tick, already resolved from whatever produced it.
// The client fills one in each frame from `keys` and `mouse`; a server will fill one in
// from a network packet. Nothing downstream knows which happened.
//
// `aim` is in world coordinates, not screen, because the camera is the client's business.
//
// The two `...Spent` flags are not noise. Attack and place are HELD, not edge-triggered -
// holding the button keeps swinging, rate-limited by the weapon cooldown. But a click that
// lands on an NPC or a resource is used up by that, and must not also swing. The original
// did this by writing `mouse.clicked = false`, which lasted until the button came back up.
// A flag on the intent reproduces exactly that and still survives being sent over a wire.
export function makeIntent() {
    return {
        moveX: 0, moveY: 0,          // -1..1 each, held
        aimX: 0, aimY: 0,            // world coordinates being pointed at
        attack: false,               // held
        place: false,                // held (right button)
        attackSpent: false, placeSpent: false,
        dash: false,                 // held; the cooldown does the rate limiting
        ability: false,              // edge
        overcharge: false,           // edge
        interact: false,             // edge
        openTalents: false,          // edge
        openBuildings: false,        // edge
        seq: 0
    };
}

// --- Geometry --------------------------------------------------------------------------
export const clampWorld = (v, max, pad) => Math.max(pad, Math.min(max - pad, v));
export function isCollidingWithObstacle(x, y, radius) {
    for (let obs of world.entities.obstacles) {
        if (obs.type === 'lake') {
            // Ellipse test on the real water body (the old circle used the box width
            // for both axes, so it blocked dry grass and let you wade in at the sides).
            let cx = obs.x + obs.w * POND_CX;
            let cy = obs.y + obs.h * POND_CY;
            let rx = obs.w * POND_RX + radius;
            let ry = obs.h * POND_RY + radius;
            let dx = (x - cx) / rx; let dy = (y - cy) / ry;
            if (dx*dx + dy*dy < 1) return true;
        } else {
            let closeX = Math.max(obs.x, Math.min(x, obs.x + obs.w)); let closeY = Math.max(obs.y, Math.min(y, obs.y + obs.h));
            let dx = x - closeX; let dy = y - closeY; if (dx*dx + dy*dy < radius*radius) return true;
        }
    }
    for (let sp of world.entities.solids) {
        let dx = x - sp.x; let dy = y - sp.y;
        if (dx*dx + dy*dy < Math.pow(sp.r + radius, 2)) return true;
    }
    for (let r of world.entities.resources) {
        if (r.solid) {
            let dx = x - r.x; let dy = y - r.y;
            if (dx*dx + dy*dy < Math.pow(r.solidRadius + radius, 2)) return true;
        }
    }
    return false;
}

// --- Presentation sink ------------------------------------------------------------------
// The simulation says playSound('hit') where the hit happens, which is how it should read.
// Where that goes is the installed sink's business. A server never installs one, so the calls
// fall into `fxNull` and cost nothing, or into `fxRecord` and become a list to ship.
const fxNull = { sound() {}, particles() {}, shake() {}, text() {} };
let fxLog = [];

const fxRecord = {
    sound:     type => fxLog.push(['sound', type]),
    particles: (x, y, color, count) => fxLog.push(['particles', Math.round(x), Math.round(y), color, count]),
    shake:     amt => fxLog.push(['shake', amt]),
    text:      (x, y, text, color) => fxLog.push(['text', Math.round(x), Math.round(y), text, color])
};

let fxInstalled = fxNull;
export let fx = fxNull;

/** The client hands in the real thing; a server never calls this. */
export function installFx(sink) {
    fxInstalled = sink;
    if (fx !== fxRecord) fx = sink;
}
/** 'record' remembers instead of playing. Returns whatever was recorded so far. */
export function setFxMode(mode) {
    const drained = fxLog;
    fxLog = [];
    fx = (mode === 'record') ? fxRecord : fxInstalled;
    return drained;
}
export function drainFx() { const d = fxLog; fxLog = []; return d; }

export function playSound(type) { fx.sound(type); }
export function spawnParticles(x, y, color, count) { fx.particles(x, y, color, count); }
export function addShake(amt) { fx.shake(amt); }

// --- UI sink --------------------------------------------------------------------------
// Same shape. `modalOpen` is the one that is not cosmetic: the world used to stop while a shop
// window was open, which is a pause alone and a frozen game for everyone else in co-op. The
// headless sink answers false, so a server keeps running while somebody shops.
const uiNull = {
    modalOpen: () => false, open() {}, closeAll() {}, phase() {}, nightButton() {},
    waveNumber() {}, weather() {}, buildPalette() {}, forgePanel() {}, hud() {},
    gameOver() {}, achievement() {}
};
let uiLog = [];

const uiHeadless = {
    modalOpen:   () => false,              // nobody is shopping on a server
    open:        name => uiLog.push(['open', name]),
    closeAll:    () => uiLog.push(['closeAll']),
    phase:       (text) => uiLog.push(['phase', text]),
    nightButton: show => uiLog.push(['nightButton', show]),
    waveNumber:  w => uiLog.push(['wave', w]),
    weather:     (text) => uiLog.push(['weather', text]),
    buildPalette: () => {},
    forgePanel:  () => {},
    hud:         () => {},
    gameOver:    () => uiLog.push(['gameOver']),
    achievement: ach => uiLog.push(['achievement', ach.id])
};

let uiInstalled = uiNull;
export let ui = uiNull;

export function installUi(sink) {
    uiInstalled = sink;
    if (ui !== uiHeadless) ui = sink;
}
export function setUiMode(mode) {
    const drained = uiLog;
    uiLog = [];
    ui = (mode === 'headless') ? uiHeadless : uiInstalled;
    return drained;
}
export function drainUi() { const d = uiLog; uiLog = []; return d; }
