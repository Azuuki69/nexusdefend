// The things a match is made of.
//
// Every class here is simulation only - the drawing was lifted onto prototypes in index.html,
// so nothing below touches a canvas, a sprite sheet or the DOM. That is what lets a Durable
// Object import this file and run the same game the browser runs.
//
// The tables and helpers that came along are the ones only these classes use: what a class
// starts with, what a building costs, what a quest asks for.

import { WORLD_W, WORLD_H, WORLD_CX, WORLD_CY, SPAWN_RING, KING_WAVE_INTERVAL, KING_HP_MULT,
    KING_DMG_BASE, KING_SPD_MULT, KING_SLAM_RANGE, KING_SLAM_CD, KING_SLAM_DMG, HARPY_HP_MULT,
    HARPY_SPD_MULT, GOB_HP_MULT, GOB_SPD_MULT, GOB_DMG_MULT, GOB_RANGE, GOB_MELEE_RANGE,
    GOB_SHOT_CD, CYCLOP_HP_MULT, CYCLOP_DMG_BASE, CYCLOP_SPD_MULT, CYCLOP_SMASH,
    CYCLOP_SMASH_CD, CYCLOP_MIN_WAVE, TROLL_HP_MULT, TROLL_DMG_BASE, TROLL_SPD_MULT,
    TROLL_REGEN, TROLL_MIN_WAVE, RIDER_HP_MULT, RIDER_SPD_MULT, RIDER_DMG_BASE,
    RIDER_CHARGE_MIN, RIDER_CHARGE_TIME, RIDER_CHARGE_SPD, RIDER_CHARGE_DMG, RIDER_CHARGE_LAND,
    RIDER_WHEEL, RIDER_KNOCKBACK, RIDER_MIN_WAVE, WANDER_SPEED, WANDER_PAUSE_MIN,
    WANDER_PAUSE_MAX, TALK_BUBBLE_TIME, POTION_LIFE, BOMBER_FUSE, HEAL_FRACTION, CRITTER_WALK1,
    CRITTER_WALK2, CRITTER_IDLE, CRITTER_EAT, CRITTERS, CRITTER_FLEE_TIME, CRITTER_PAUSE_MIN,
    CRITTER_PAUSE_MAX, AGGRO_RANGE, AGGRO_RANGE_GOLEM, AGGRO_HOLD, AGGRO_DROP, MAX_EXTRACTORS,
    EXTRACTOR_COST, TP_PER_LEVEL, TALENT_XP_GROWTH, FREEZE_DURATION, FREEZE_IMMUNITY,
    BEAR_LOOT_BASE, BEAR_LOOT_PER_WAVE, NEXUS_KEEPOUT, MERCHANT_FRAMES, HERO_WALK,
    ATTACK_ANIM_TIME, BODY_OFFSET_X, PREDATOR_BASE_HP, PREDATOR_HP_GROWTH, RAIN_RADIUS,
    RAIN_DURATION, RAIN_TICK_DMG, RAIN_SPLINTERS, ORC_MELEE_RANGE, KING_RADIUS, GOB_RADIUS,
    CYCLOP_RADIUS, TROLL_RADIUS, RIDER_FEET, RIDER_RADIUS, EXTRACTOR_SPACING, EXTRACTOR_HP,
    NEXUS_RADIUS, RES_START, RES_PER_DAY, RES_MAX, MERCHANT_VISIT_DAYS
} from './constants.js';
import { rnd, killCredit, nearestPlayer, nearestPlayerDist, playersInRange, coopToughMult,
    nexusMaxHpFor, makeBuffs, makeIntent, isCollidingWithObstacle, playSound, spawnParticles,
    addShake, world, clampWorld, fx, ui
} from './world.js';

// Ring position around the nexus, biased to one side (0=top 1=bottom 2=left 3=right).
export function ringSpawn(side) {
    let base_ang = (side === 0 ? -Math.PI/2 : side === 1 ? Math.PI/2 : side === 2 ? Math.PI : 0);
    let last = null;
    // Retry: landing inside one of the lakes leaves the spawn permanently stuck.
    for (let attempt = 0; attempt < 24; attempt++) {
        let ang = base_ang + (rnd() - 0.5) * 1.3;
        let r = SPAWN_RING + rnd() * 250;
        last = { x: clampWorld(WORLD_CX + Math.cos(ang) * r, WORLD_W, 40),
                 y: clampWorld(WORLD_CY + Math.sin(ang) * r, WORLD_H, 40) };
        if (!isCollidingWithObstacle(last.x, last.y, 45)) return last;
    }
    return last;
}

// --- Wayfarer contracts -------------------------------------------------------
// One at a time, taken and handed in by talking to him. Paid in mana and experience,
// never wood or stone: mana is the shop currency the economy pass made scarce, so a
// contract is a reason to go out and fight rather than a second gathering loop. Kept small
// on purpose: at one hand-in a day the original numbers roughly doubled mana income and
// would have undone the economy pass, so experience is the headline reward instead.
// `kind` says which list the kill is counted from - wildlife and monsters are separate
// arrays and always have been.
export const QUESTS = [
    { id:'boar',    kind:'critter', target:'boar',         need:3,  mana:16  ,  xp:70,   minWave:1,
      give:"Boar have been rooting through my cache. Put down three and I'll make it worth the walk.",
      done:"That's the three. Here - you've earned it." },
    { id:'rabbit',  kind:'critter', target:'rabbit',       need:5,  mana:12  ,  xp:50,   minWave:1,
      give:"Five hares would keep me fed a week. Bring me the count and I'll pay.",
      done:"Five. You've a quicker hand than I do." },
    { id:'deer',    kind:'critter', target:'deer',         need:4,  mana:20  ,  xp:90,   minWave:2,
      give:"Four deer. I need the hides more than the meat, so mind you don't waste them.",
      done:"Four hides. That'll see me through the cold." },
    { id:'goblin',  kind:'enemy',   target:'goblin',       need:12, mana:18  ,  xp:110,  minWave:1,
      give:"Twelve goblins. They're the least of what's out there, but they're the ones that never stop.",
      done:"Twelve fewer. It won't last, but it helps." },
    { id:'wolf',    kind:'enemy',   target:'wolf',         need:10, mana:19  ,  xp:120,  minWave:1,
      give:"The wolves are running with them now. Thin the pack - ten should do it.",
      done:"The pack's thinner. Take this." },
    { id:'orcarch', kind:'enemy',   target:'orcarcher',    need:8,  mana:24  ,  xp:150,  minWave:2,
      give:"Their archers are the ones killing you at range. Eight of them, and mind the arrows.",
      done:"Eight bows quieted. Good." },
    { id:'gobarch', kind:'enemy',   target:'goblinarcher', need:8,  mana:26  ,  xp:165,  minWave:3,
      give:"Wolf-riders. Fast, and they don't stand still to be hit. Eight.",
      done:"Eight riders down. That's proper work." },
    { id:'harpy',   kind:'enemy',   target:'harpy',        need:6,  mana:25  ,  xp:160,  minWave:3,
      give:"Six of the winged ones. Your traps won't help you - they never touch the ground.",
      done:"Six out of the air. Not many manage that." },
    { id:'golem',   kind:'enemy',   target:'golem',        need:5,  mana:32  ,  xp:210,  minWave:5,
      give:"Five stone golems. Slow, but you'll need something with weight behind it.",
      done:"Five broken open. Here." },
    { id:'troll',   kind:'enemy',   target:'troll',        need:1,  mana:48  ,  xp:320,  minWave:5,
      give:"A troll walks these woods. Kill it - and remember, fire is what stops it mending.",
      done:"You killed the troll. I did not truly think you would." },
    { id:'cyclop',  kind:'enemy',   target:'cyclop',       need:1,  mana:52  , xp:360,  minWave:4,
      give:"There's a one-eyed brute out there. Bring me word that it's dead.",
      done:"The brute is down. Take this and my thanks." },
    { id:'rider',   kind:'enemy',   target:'orcrider',     need:4,  mana:42  ,  xp:300,  minWave:6,
      give:"Four warg riders. Catch them before they build up speed, or they'll ride you down.",
      done:"Four riders unhorsed. That's a hard-won thing." }
];

export function bearLoot() { return BEAR_LOOT_BASE + BEAR_LOOT_PER_WAVE * world.wave; }

export function resourceCountFor(day) { return Math.min(RES_MAX, RES_START + (day - 1) * RES_PER_DAY); }

// --- PLACEABLE BUILDINGS ---
// Both are raised by hand from gathered resources. Costs sit above the 50/50 you start
// with on purpose: the first thing every run makes you do is go and gather.
// Not a constant in the pure sense: each entry counts what is already built, which
// means reading `world`. It cannot live in src/sim/constants.js for exactly that
// reason - that module has no world - so it stays here with the client.
export const BUILDINGS = {
    forge: {
        name: 'The Forge', icon: '🔥', max: 1,
        cost: { w: 60, s: 60, m: 0 },
        desc: 'Unlocks weapon, gear and Nexus upgrades. Walk to it and press [R].',
        count: () => world.forgeBuilding ? 1 : 0
    },
    extractor: {
        name: 'Extractor', icon: '⛏️', max: MAX_EXTRACTORS,
        cost: { w: EXTRACTOR_COST, s: EXTRACTOR_COST, m: 0 },
        desc: 'Pulls 2 wood and 2 stone from the ground every 4s, daylight only.',
        count: () => world.entities.extractors.length
    }
};

export function buildingCost(key, p) {
    let c = BUILDINGS[key].cost, mod = (p || world.players[0]) ? (p || world.players[0]).buildCostMod : 1;
    return { w: Math.floor(c.w * mod), s: Math.floor(c.s * mod), m: Math.floor(c.m * mod) };
}

export function canAfford(c) { return world.inventory.wood >= c.w && world.inventory.stone >= c.s && world.inventory.mana >= c.m; }

// The bear is meant to be an occasional scare, not a fixture. Rolled per day, with a
// minimum gap so it can never turn up on back-to-back days and clump together.
// Rain of Arrows: a lingering zone that ticks every 0.5s for its duration.
export function merchantVisits(day) { return (day - 1) % MERCHANT_VISIT_DAYS === 0; }

export let achievements = [
    { id: 'first_blood', name: 'First Blood', desc: 'Slay your first enemy.', unlocked: false },
    { id: 'lumberjack', name: 'Lumberjack', desc: 'Gather 50 Wood.', unlocked: false },
    { id: 'mason', name: 'Mason', desc: 'Gather 50 Stone.', unlocked: false },
    { id: 'builder', name: 'Architect', desc: 'Build 3 Extractors.', unlocked: false }
];

export function checkAchievement(id) {
    let ach = achievements.find(a => a.id === id);
    if (ach && !ach.unlocked) {
        ach.unlocked = true; playSound('levelup'); ui.achievement(ach);
        return;
    }
}

// Attack values were set when every class had two towers doing a share of the killing, and
// the two classes whose third path was built entirely on towers - the mage's Archmage and
// the priest's Inquisitor - were also the two carrying the smallest weapons. On foot alone
// they were a third of the archer's damage, so both come up. The archer stays the ceiling
// and the warrior stays the multi-target bruiser; this closes a gap, it does not level it.
export const classDataInfo = {
    warrior: { hp: 200, mp: 50, spd: 4, atk: 35, range: 80, cd: 0.6, type: 'melee', color: '#ff4d4d', abCost: 20, abCd: 5.0 },
    mage: { hp: 120, mp: 150, spd: 3.5, atk: 26, range: 400, cd: 0.8, type: 'ranged', color: '#5ce1e6', abCost: 40, abCd: 6.0 },
    archer: { hp: 120, mp: 90, spd: 5.5, atk: 25, range: 600, cd: 0.35, type: 'ranged', color: '#4dff4d', abCost: 25, abCd: 7.0 },
    priest: { hp: 140, mp: 120, spd: 4, atk: 22, range: 350, cd: 0.6, type: 'ranged', color: '#ffe666', abCost: 35, abCd: 8.0 }
};

export class Obstacle {
    constructor(x, y, w, h, type) { this.x = x; this.y = y; this.w = w; this.h = h; this.type = type; }
}

export class Merchant {
    constructor() { this.isShop = true; let fromLeft = rnd() > 0.5; this.x = WORLD_CX + (fromLeft ? -1500 : 1500); this.y = WORLD_CY + (rnd()*400 - 200); this.radius = 20; this.targetX = WORLD_CX + (rnd()*500 - 250); this.targetY = WORLD_CY - 320 - rnd()*160; this.markedForDeletion = false; this.frame = 0; this.frameTimer = 0; this.facing = 1; this.moving = true; }
    update(dt) {
        if (world.gameState === 'NIGHT') { this.targetX = WORLD_CX - 2600; }
        let dx = this.targetX - this.x; let dy = this.targetY - this.y; let len = Math.hypot(dx, dy);
        this.moving = len > 5;
        if (this.moving) {
            this.x += (dx/len) * 2 * (dt*60); this.y += (dy/len) * 2 * (dt*60);
            if (Math.abs(dx) > 1) this.facing = dx < 0 ? -1 : 1;
            this.frameTimer += dt;
            if (this.frameTimer > 0.11) { this.frameTimer = 0; this.frame = (this.frame + 1) % MERCHANT_FRAMES.length; }
        } else { this.frame = 0; this.frameTimer = 0; }
        if (world.gameState === 'NIGHT' && Math.hypot(this.x - WORLD_CX, this.y - WORLD_CY) > 1800) this.markedForDeletion = true;
    }
}

// He crosses the whole map rather than orbiting the nexus, and what he trades in is
// information - what is coming tonight, and what it is weak to. Deliberately gives no
// wood, stone or mana: the economy was just tuned, and a free handout every day would
// quietly undo it.
export class Wanderer {
    constructor() {
        // He is built after generateMap has already scattered the trees, so the spot has
        // to be checked here - dropped inside a trunk he can never walk out of it.
        this.x = WORLD_CX; this.y = WORLD_CY - 400;
        for (let t = 0; t < 40; t++) {
            let a = rnd() * Math.PI * 2, d = 500 + rnd() * 1700;
            let nx = clampWorld(WORLD_CX + Math.cos(a) * d, WORLD_W, 150);
            let ny = clampWorld(WORLD_CY + Math.sin(a) * d, WORLD_H, 150);
            if (!isCollidingWithObstacle(nx, ny, 20)) { this.x = nx; this.y = ny; break; }
        }
        this.radius = 20; this.isShop = false; this.markedForDeletion = false;
        this.frame = 0; this.frameTimer = 0; this.facing = 1; this.moving = false;
        this.pause = 0; this.bubble = 0; this.line = '';
        this.pickWaypoint();
    }
    pickWaypoint() {
        for (let i = 0; i < 24; i++) {
            let tx = 150 + rnd() * (WORLD_W - 300);
            let ty = 150 + rnd() * (WORLD_H - 300);
            if (!isCollidingWithObstacle(tx, ty, this.radius)) { this.targetX = tx; this.targetY = ty; return; }
        }
        this.targetX = WORLD_CX; this.targetY = WORLD_CY;
    }
    talk() {
        this.bubble = TALK_BUBBLE_TIME;
        this.pause = Math.max(this.pause, 2.0);      // he stops to speak to you
        if (!world.activeQuest) {
            let q = questOffer();
            startQuest(q);
            this.line = q.give;
            playSound('levelup');
        } else if (world.activeQuest.have >= world.activeQuest.need) {
            this.line = turnInQuest();
        } else {
            // Still working: remind them what for, and pay the walk back with a rumour.
            let left = world.activeQuest.need - world.activeQuest.have;
            this.line = left + " more to go. " + wayfarerLine();
            playSound('pickup');
        }
    }
    update(dt) {
        if (this.bubble > 0) this.bubble -= dt;
        if (this.pause > 0) { this.pause -= dt; this.moving = false; this.frame = 0; return; }

        let dx = this.targetX - this.x, dy = this.targetY - this.y, len = Math.hypot(dx, dy);
        if (len < 14) {
            this.pause = WANDER_PAUSE_MIN + rnd() * (WANDER_PAUSE_MAX - WANDER_PAUSE_MIN);
            this.moving = false; this.frame = 0; this.pickWaypoint(); return;
        }
        this.moving = true;
        let speed = WANDER_SPEED * (dt * 60), ang = Math.atan2(dy, dx), moved = false;
        for (let off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
            let nx = this.x + Math.cos(ang + off) * speed, ny = this.y + Math.sin(ang + off) * speed;
            if (!isCollidingWithObstacle(nx, ny, this.radius)) {
                if (Math.abs(nx - this.x) > 0.01) this.facing = nx < this.x ? -1 : 1;
                this.x = nx; this.y = ny; moved = true; break;
            }
        }
        if (!moved) this.pickWaypoint();             // hemmed in, try somewhere else
        this.frameTimer += dt;
        if (this.frameTimer > 0.17) { this.frameTimer = 0; this.frame = this.frame === 1 ? 2 : 1; }
    }
}

export function questOffer() {
    let pool = QUESTS.filter(q => world.wave >= q.minWave);
    return pool[Math.floor(rnd() * pool.length)];
}

export function startQuest(q) {
    world.activeQuest = { id: q.id, kind: q.kind, target: q.target, need: q.need,
                    have: 0, mana: q.mana, xp: q.xp, label: q.id };
    updateQuestUI();
}

// Called from both death paths. Wildlife and monsters live in different arrays, so the
// kind has to match too or hunting rabbits would tick a goblin contract.
export function questKill(kind, type) {
    if (!world.activeQuest || world.activeQuest.have >= world.activeQuest.need) return;
    if (world.activeQuest.kind !== kind || world.activeQuest.target !== type) return;
    world.activeQuest.have++;
    updateQuestUI();
    if (world.activeQuest.have >= world.activeQuest.need) {
        const finisher = killCredit();
        if (finisher) world.entities.texts.push(new FloatingText(finisher.x, finisher.y - 70, "CONTRACT COMPLETE", '#4dff88'));
        playSound('levelup');
    }
}

export function updateQuestUI() { /* the tracker is drawn on the canvas - nothing to sync */ }

export function turnInQuest() {
    let def = QUESTS.find(q => q.id === world.activeQuest.id);
    world.inventory.mana += world.activeQuest.mana;
    const claimant = killCredit();
    if (claimant) claimant.gainXp(world.activeQuest.xp);
    world.entities.texts.push(new FloatingText(claimant.x, claimant.y - 60, "+" + world.activeQuest.mana + " MANA", '#00ffcc'));
    world.entities.texts.push(new FloatingText(claimant.x, claimant.y - 90, "+" + world.activeQuest.xp + " XP", '#ffe066'));
    spawnParticles(claimant.x, claimant.y, '#e8d8a8', 20);
    playSound('levelup'); addShake(5);
    world.activeQuest = null;
    updateQuestUI();
    return def.done;
}

// What he actually knows. Weighted toward tonight's specifics when there are any, so
// talking to him is worth the walk rather than being flavour text.
export function wayfarerLine() {
    const dirName = ['north', 'south', 'west', 'east'];
    let pool = [];
    if (world.waveDirection !== -1) {
        pool.push("They gather to the " + dirName[world.waveDirection] + " tonight. I'd face your guns that way.");
    }
    if (world.wave % KING_WAVE_INTERVAL === KING_WAVE_INTERVAL - 1) {
        pool.push("The drums are wrong. Come tomorrow night, their King walks - and he brings the ground down with him.");
    } else if ((world.wave + 1) % 5 === 0) {
        pool.push("Something big is coming for you tomorrow. Bigger than what you've buried so far.");
    }
    if (world.wave >= TROLL_MIN_WAVE) pool.push("If a troll comes, don't trust your eyes - it knits itself back up. Burn it and the mending stops.");
    if (world.wave >= CYCLOP_MIN_WAVE) pool.push("The one-eyed brute swings wide and hits hard. Don't stand still in front of it.");
    if (world.wave >= RIDER_MIN_WAVE) pool.push("Warg riders need a run-up. Break their line early and they're just orcs on dogs.");
    if (world.wave > 2) pool.push("Winged ones come straight over the treeline. Nothing on the ground will slow them.");
    pool.push("Nothing stands between you and them any more. You are the wall.");
    pool.push("Raise your extractors early - they only work by daylight, and they pay all night for it.");
    pool.push("Bear's worth more than it looks, if you can take it. But it only prowls by daylight.");
    pool.push("I've walked from the coast. There's nothing left out there but what's coming here.");
    pool.push("Chop what you can before dusk. The forest thickens each day, but so do they.");
    return pool[Math.floor(rnd() * pool.length)];
}

export class Critter {
    constructor(type, x, y) {
        this.type = type; this.def = CRITTERS[type];
        this.x = x; this.y = y; this.radius = this.def.radius;
        this.hp = this.def.hp; this.maxHp = this.def.hp;
        this.markedForDeletion = false;
        this.facing = rnd() < 0.5 ? -1 : 1;
        this.frame = CRITTER_IDLE; this.frameTimer = 0;
        this.pause = rnd() * CRITTER_PAUSE_MAX;
        this.fleeTimer = 0; this.grazing = rnd() < 0.5;
        this.tx = x; this.ty = y;
        this.pickWaypoint();
    }
    pickWaypoint() {
        for (let i = 0; i < 16; i++) {
            let a = rnd() * Math.PI * 2, r = 300 + rnd() * 550;
            let tx = clampWorld(this.x + Math.cos(a) * r, WORLD_W, 120);
            let ty = clampWorld(this.y + Math.sin(a) * r, WORLD_H, 120);
            if (!isCollidingWithObstacle(tx, ty, this.radius)) { this.tx = tx; this.ty = ty; return; }
        }
        this.tx = this.x; this.ty = this.y;
    }
    // It has no attack and never retaliates - being hurt only makes it run.
    takeDamage(amount) {
        if (this.markedForDeletion) return;
        this.hp -= amount;
        // The Beast Caller keeps wounded game where it stands.
        if (!world.campOneOffs.beastcall) { this.fleeTimer = CRITTER_FLEE_TIME; this.pause = 0; }
        spawnParticles(this.x, this.y, '#8f3a3a', 4);
        if (this.hp <= 0) {
            this.markedForDeletion = true;
            questKill('critter', this.type);
            spawnParticles(this.x, this.y, '#8f3a3a', 16);
            playSound('hit');
            if (world.campOneOffs.skinning || rnd() < this.def.meat) world.entities.items.push(new Item(this.x, this.y, 'hp'));
        }
    }
    update(dt) {
        let tx, ty, moveSpd;
        if (this.fleeTimer > 0) {
            this.fleeTimer -= dt;
                const threat = nearestPlayer(this.x, this.y);            // whoever is closest
            let a = threat ? Math.atan2(this.y - threat.y, this.x - threat.x) : this.facing * Math.PI;
            tx = this.x + Math.cos(a) * 500; ty = this.y + Math.sin(a) * 500;
            moveSpd = this.def.flee;
            if (this.fleeTimer <= 0) { this.pause = 1.0 + rnd(); this.pickWaypoint(); }
        } else if (this.pause > 0) {
            this.pause -= dt;
            this.frameTimer += dt;
            if (this.frameTimer > 1.3) { this.frameTimer = 0; this.grazing = !this.grazing; }
            this.frame = this.grazing ? CRITTER_EAT : CRITTER_IDLE;
            if (this.pause <= 0) this.pickWaypoint();
            return;
        } else {
            tx = this.tx; ty = this.ty; moveSpd = this.def.spd;
        }
        let dx = tx - this.x, dy = ty - this.y, len = Math.hypot(dx, dy);
        if (len < 16 && this.fleeTimer <= 0) {
            this.pause = CRITTER_PAUSE_MIN + rnd() * (CRITTER_PAUSE_MAX - CRITTER_PAUSE_MIN);
            this.frame = CRITTER_IDLE; this.frameTimer = 0; return;
        }
        let step = moveSpd * (dt * 60), ang = Math.atan2(dy, dx), moved = false;
        for (let off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
            let nx = this.x + Math.cos(ang + off) * step, ny = this.y + Math.sin(ang + off) * step;
            if (nx < 80 || nx > WORLD_W - 80 || ny < 80 || ny > WORLD_H - 80) continue;
            if (!isCollidingWithObstacle(nx, ny, this.radius)) {
                if (Math.abs(nx - this.x) > 0.01) this.facing = nx < this.x ? -1 : 1;
                this.x = nx; this.y = ny; moved = true; break;
            }
        }
        if (!moved) this.pickWaypoint();
        this.frameTimer += dt;
        let cadence = this.fleeTimer > 0 ? 0.09 : 0.19;      // legs go faster when bolting
        if (this.frameTimer > cadence) {
            this.frameTimer = 0;
            this.frame = this.frame === CRITTER_WALK1 ? CRITTER_WALK2 : CRITTER_WALK1;
        }
    }
}

export class Item {
    constructor(x, y, type) { this.x = x; this.y = y; this.type = type; this.radius = 14; this.markedForDeletion = false;
        this.life = POTION_LIFE; this.bob = Math.random() * 6.283; }
    update(dt) {
        this.life -= dt;
        if (this.life <= 0) { spawnParticles(this.x, this.y, this.type === 'hp' ? '#c8324a' : '#3a7fd5', 6); this.markedForDeletion = true; return; }
        // Whoever walks over it gets it, not whoever happens to be this client.
        const taker = world.players.find(p => p.hp > 0 && Math.hypot(p.x - this.x, p.y - this.y) < p.radius + this.radius);
        if (taker) {
            if(this.type === 'hp') { taker.hp = Math.min(taker.maxHp, taker.hp + 50); world.entities.texts.push(new FloatingText(this.x, this.y, "+50 HP", '#00ff00')); }
            if(this.type === 'mp') { taker.mp = Math.min(taker.maxMp, taker.mp + 50); world.entities.texts.push(new FloatingText(this.x, this.y, "+50 MP", '#00ffff')); }
            playSound('pickup'); this.markedForDeletion = true;
        }
    }
}

export class Particle {
    constructor(x, y, vx, vy, color) { this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.color = color; this.life = 0.5 + Math.random() * 0.5; this.markedForDeletion = false; }
    update(dt) { this.x += this.vx * dt * 60; this.y += this.vy * dt * 60; this.vx *= 0.9; this.vy *= 0.9; this.life -= dt; if(this.life <= 0) this.markedForDeletion = true; }
}

export class FloatingText {
    constructor(x, y, text, color) { fx.text(x, y, text, color); this.x = x; this.y = y; this.text = text; this.color = color; this.life = 1.0; this.vy = -30; this.markedForDeletion = false; }
    update(dt) { this.y += this.vy * dt; this.life -= dt; if (this.life <= 0) this.markedForDeletion = true; }
}

export class Effect {
    constructor(x, y, radius, color, life, dmg=0, freeze=false, isScorched=false, element='none', source='player', style='blob') {
        this.x = x; this.y = y; this.radius = radius; this.color = color; this.life = life; this.maxLife = life; this.markedForDeletion = false; this.dmg = dmg; this.freeze = freeze; this.isScorched = isScorched; this.pulseTimer = 0; this.element = element; this.source = source; this.style = style;
        if (style === 'arrowrain') {
            // Fixed scatter so the volley doesn't jitter between frames.
            this.shafts = [];
            for (let i = 0; i < 26; i++) {
                let a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * radius;
                this.shafts.push({ ox: Math.cos(a) * d, oy: Math.sin(a) * d * 0.45, delay: Math.random(), dur: 0.34 + Math.random() * 0.22 });
            }
        }
    }
    update(dt) {
        this.life -= dt;
        if (this.isScorched) {
            this.pulseTimer -= dt;
            if (this.pulseTimer <= 0) {
                world.entities.enemies.forEach(e => { 
                    if (e.type === 'assassin' && e.isInvisible) return;
                    if (Math.hypot(e.x - this.x, e.y - this.y) < this.radius) { e.takeDamage(this.dmg, true, this.element, this.source); playSound('hit'); } 
                });
                this.pulseTimer = 0.5;
            }
        } else if (this.dmg > 0 && this.life < this.maxLife/2) {
            // Who a blast hurts is decided by who set it off, never by what colour it is.
            // Keying it off the colour and element matched exactly the wrong blasts: the
            // bomber's carries element 'none', so it went off harmlessly in your face, while
            // the priest's Smite and the archer's splinters pass 'fire' and so detonated on
            // their own owner, the Nexus and the extractors.
            if (this.source === 'enemy') {
                playersInRange(this.x, this.y, this.radius).forEach(p => p.takeDamage(this.dmg));
                if (Math.hypot(world.base.x - this.x, world.base.y - this.y) < this.radius + world.base.radius) world.base.takeDamage(this.dmg);
                world.entities.extractors.forEach(t => { if (Math.hypot(t.x - this.x, t.y - this.y) < this.radius) t.takeDamage(this.dmg); });
                playSound('explosion');
            } else {
                world.entities.enemies.forEach(e => {
                    if (e.type === 'assassin' && e.isInvisible) return;
                    if (Math.hypot(e.x - this.x, e.y - this.y) < this.radius) {
                        e.takeDamage(this.dmg, this.source === 'player', this.element, this.source); playSound('hit');
                    }
                });
            }
            this.dmg = 0; 
        }
        if(this.life <= 0) this.markedForDeletion = true;
    }
}

export class Entity {
    constructor(x, y, radius, hp) { this.x = x; this.y = y; this.radius = radius; this.hp = hp; this.maxHp = hp; this.shield = 0; this.markedForDeletion = false; }
    takeDamage(amount, isPlayerSource = false, element = 'none', source = 'player', attacker = null) {
        if (this.invincible) return;
        
        // An armoured horde used to shrug off tower fire specifically. With the towers gone
        // that clause matched nothing, so the modifier now blunts every hit - and by a
        // quarter rather than a half, since it is your own damage it is biting into.
        if (this instanceof Enemy && world.currentModifier === 'armored') {
            amount = amount * 0.75;
        }
        
        let dmg = Math.floor(amount * (this.dmgReduc || 1.0));
        const burner = nearestPlayer(this.x, this.y);
        if (this instanceof Enemy && this.burningTimer > 0 && burner && burner.burnBonus > 0) dmg = Math.floor(dmg * (1 + burner.burnBonus));

        // Critical strikes: only your own hits can crit, not environmental damage.
        let isCrit = false;
        const dealer = (isPlayerSource && source === 'player') ? killCredit() : null;
        if (dealer && dealer.buffs.critChance > 0 && rnd() < dealer.buffs.critChance) {
            dmg = Math.floor(dmg * dealer.buffs.critMult); isCrit = true;
        }
        
        if (this instanceof Enemy) {
            if (element === 'fire') {
                if (this.frozenTimer > 0) {
                    this.frozenTimer = 0; dmg *= 2.5;
                    world.entities.texts.push(new FloatingText(this.x, this.y - 30, "THERMAL SHOCK!", '#ffaa00'));
                    world.entities.effects.push(new Effect(this.x, this.y, 60, '#ffaa00', 0.2, dmg * 0.5, false, false, 'none', source));
                    playSound('explosion'); addShake(3);
                } else { this.burningTimer = 3.0; }
            } else if (element === 'ice') {
                if (this.burningTimer > 0) {
                    this.burningTimer = 0; dmg *= 2.5;
                    world.entities.texts.push(new FloatingText(this.x, this.y - 30, "THERMAL SHOCK!", '#00ffff'));
                    world.entities.effects.push(new Effect(this.x, this.y, 60, '#00ffff', 0.2, dmg * 0.5, false, false, 'none', source));
                    playSound('explosion'); addShake(3);
                } else if (this.freezeImmuneTimer <= 0) {
                    this.frozenTimer = FREEZE_DURATION;
                    this.freezeImmuneTimer = FREEZE_DURATION + FREEZE_IMMUNITY;
                } else if (Math.random() < 0.08) {
                    world.entities.texts.push(new FloatingText(this.x, this.y - 40, "RESIST", '#9ad4ff'));
                }
            }
        }
        
        if (this.shield > 0) {
            if (this.shield >= dmg) { this.shield -= dmg; dmg = 0; }
            else { dmg -= this.shield; this.shield = 0; }
        }

        // Your own shield burns your own mana. The Nexus is covered by anyone who took it.
        const shielder = world.players.includes(this) ? (this.manaShield ? this : null)
                       : (this === world.base ? world.players.find(p => p.manaShield && p.mp > 0) : null);
        if (dmg > 0 && shielder) {
            let absorbed = Math.min(Math.floor(dmg * 0.5), shielder.mp);
            shielder.mp -= absorbed; dmg -= absorbed;
        }

        this.hp -= dmg;
        
        if (isPlayerSource && dmg > 0) { world.gameStats.dmg += dmg; const c = killCredit(); if (c && c.buffs.vampirism > 0) c.hp = Math.min(c.maxHp, c.hp + dmg * c.buffs.vampirism); }
        if (isPlayerSource && dmg > 0 && this instanceof Enemy && source === 'player') this.aggroTimer = AGGRO_HOLD;

        // Thorns pays back whoever actually swung at you.
        const spiked = world.players.includes(this) ? this
                     : (this === world.base ? world.players.reduce((b, p) => (!b || p.buffs.thorns > b.buffs.thorns) ? p : b, null) : null);
        if (dmg > 0 && spiked && spiked.buffs.thorns > 0 && attacker && attacker instanceof Enemy) {
            let back = Math.max(1, Math.floor(dmg * spiked.buffs.thorns));
            attacker.takeDamage(back, true, 'none', 'player');
            spawnParticles(attacker.x, attacker.y, '#7ef7d8', 3);
            // Unbreakable: what you throw back, you take in.
            const reflector = world.players.includes(this) ? this : world.players.find(p => p.reflectHeals);
            if (reflector && reflector.reflectHeals) {
                let mend = Math.max(1, Math.floor(back * 0.5));
                reflector.hp = Math.min(reflector.maxHp, reflector.hp + mend);
                world.entities.texts.push(new FloatingText(reflector.x, reflector.y - 50, '+' + mend, '#7ef7d8'));
            }
        }
        
        if (this instanceof Enemy) {
            if (this.isAsleep) {
                this.isAsleep = false;
                world.entities.texts.push(new FloatingText(this.x, this.y - 50, "AWAKENED!", '#ff0000'));
                playSound('error'); addShake(10);
            }
            if (dmg > 0) world.entities.texts.push(new FloatingText(this.x, this.y - this.radius, isCrit ? dmg + '!' : dmg, isCrit ? '#ff7b2e' : '#ffcc00'));
            if (dmg > 0) playSound('hit'); 
        }
        if ((this instanceof Base || this instanceof Extractor) && dmg > 0) addShake(2);

        if (this.hp <= 0 && !this.markedForDeletion && this instanceof Enemy) {
            const killer = killCredit();
            if (killer && killer.buffs.lifeOnKill > 0) {
                killer.hp = Math.min(killer.maxHp, killer.hp + killer.buffs.lifeOnKill);
                world.entities.texts.push(new FloatingText(killer.x, killer.y - 50, '+' + killer.buffs.lifeOnKill, '#4dff88'));
            }
        }
        // Warlord's Tribute: the spoils come off the corpse, not the treeline.
        if (this.hp <= 0 && !this.markedForDeletion && this instanceof Enemy && killCredit() && killCredit().killTribute) {
            world.inventory.wood += 2; world.inventory.stone += 2;
            world.entities.texts.push(new FloatingText(this.x, this.y - 32, '+2W +2S', '#ffcc00'));
        }
        if (this.hp <= 0 && !this.markedForDeletion) {
            this.markedForDeletion = true;

            if (this instanceof Enemy) {
                world.gameStats.kills++; world.totalKills++;
                questKill('enemy', this.type);
                if (world.totalKills === 1) checkAchievement('first_blood');
                
                if (this.type === 'predator') {
                    let loot = bearLoot();
                    world.inventory.mana += loot; world.inventory.wood += loot; world.inventory.stone += loot;
                    world.entities.texts.push(new FloatingText(this.x, this.y, "+" + loot + " EACH!", '#ffcc00'));
                    playSound('levelup');
                } else {
                    // Trash pays 14 rather than 10. Levels are the only power you accumulate
                    // now, and there are fewer bodies per wave to earn them from.
                    let xpDrop = this.type === 'orcking' ? 600 : (this.type === 'boss' ? 200 : (this.type === 'cyclop' ? 140 :
                                 (this.type === 'troll' ? 100 : (this.type === 'orcrider' ? 55 : (this.type === 'golem' ? 34 : (this.type === 'bomber'? 24 : 14))))));
                    // A swarm night doubles the column and sets every body in it to 1 HP.
                    // Paid at full rate that made the safest night of the run comfortably the
                    // richest - a bloodmoon swarm was worth roughly 900 mana for no fight at
                    // all. They pay a quarter, so it stays a breather rather than a payday.
                    let swarmCut = this.swarmling ? 0.25 : 1;
                    // Experience is personal, so it goes to the killer rather than the party.
                    const scorer = killCredit();
                    if (scorer) scorer.gainXp(Math.max(1, Math.floor(xpDrop * swarmCut)) * (world.currentWeather==='bloodmoon'?3:1));
                    
                    // Trash mana creeps up with the waves. Raising forge and shop prices without
                    // this would leave mana the permanent bottleneck on everything and a long run
                    // unable to finish the tree at all. It does not compound the way the pickaxe
                    // did - you earn it by killing more, which is the loop already being asked of you.
                    let trashMana = 2 + Math.floor(world.wave / 5);
                    let manaDrop = this.type === 'orcking' ? 150 : (this.type === 'boss' ? 50 : (this.type === 'cyclop' ? 35 :
                                   (this.type === 'troll' ? 25 : (this.type === 'orcrider' ? 12 : (this.type === 'golem' ? 5 : trashMana)))));
                    manaDrop = Math.max(1, Math.floor(manaDrop * swarmCut)) * (world.currentWeather==='bloodmoon'?3:1);
                    // Mana into the shared pot; the trickle of personal mana to the killer.
                    world.inventory.mana += manaDrop;
                    const gainer = killCredit();
                    if (gainer) gainer.mp = Math.min(gainer.maxMp, gainer.mp + 5);

                    let pColor = this.type === 'golem' ? '#777' : (this.type === 'harpy' ? '#7a6a3a' : '#5b9e32');
                    spawnParticles(this.x, this.y, pColor, this.radius);
                    if (rnd() < 0.1) world.entities.items.push(new Item(this.x, this.y, rnd()>0.5?'hp':'mp'));
                    // Night visitors are a fight you did not pick, so they always pay out.
                    if (this.type === 'cyclop' || this.type === 'troll') world.entities.items.push(new Item(this.x, this.y, rnd()>0.5?'hp':'mp'));
                    
                    if (this.type === 'bomber') { world.entities.effects.push(new Effect(this.x, this.y, 100, '#ffaa00', 0.5, 40, false, false, 'none', 'enemy')); addShake(15); playSound('explosion'); }
                }
            }
        } 
    }
}

export class Base extends Entity {
    constructor() { super(WORLD_CX, WORLD_CY, NEXUS_RADIUS, nexusMaxHpFor(world.wave)); this.repairedToday = false; this.regenTimer = 0; this.hasBrazier = false; this.overchargeCd = 0; this.overchargeActive = 0; }
    // Called when the wave advances: the structure hardens without erasing existing damage.
    recalcMaxHp() {
        let want = nexusMaxHpFor(world.wave);
        if (want > this.maxHp) { let gain = want - this.maxHp; this.maxHp = want; this.hp += gain; }
        else this.maxHp = want;
        this.hp = Math.min(this.hp, this.maxHp);
    }
    update(dt) {
        if (this.overchargeCd > 0) this.overchargeCd -= dt;
        if (this.overchargeActive > 0) this.overchargeActive -= dt;
    
        if (world.players.some(p => p.baseRegen) || this.hasBrazier) { this.regenTimer += dt; if (this.regenTimer >= 2.0) { this.hp = Math.min(this.maxHp, this.hp + (this.hasBrazier ? 12 : 5)); this.regenTimer = 0; } }
    }
}

export class Player extends Entity {
    constructor(cls) {
        super(WORLD_CX, WORLD_CY + 215, 20, classDataInfo[cls].hp);
        // Copy, don't alias: talents write to data.abCd / data.abCost, and with a shared
        // reference those edits leaked into every later run of that class.
        this.cls = cls; this.data = Object.assign({}, classDataInfo[cls]);
        this.maxMp = this.data.mp; this.mp = this.maxMp;
        this.spd = this.data.spd; this.atk = this.data.atk; this.attackCd = this.data.cd;
        this.lastAttack = 0; this.angle = 0; this.abTimer = 0; this.abilityCooldownTimer = 0; this.whirlTick = 0;
        this.abMaxTimer = 1.5; this.whirlSpin = 0; this.whirlPulse = 0;
        this.level = 1; this.xp = 0; this.maxXp = 150; 
        this.tp = 0; this.chosenPath = null; this.talents = []; this.paragonPoints = 0;
        this.hasDaySpeed = false;
        this.wasOvercharged = false;
        this.shiftCd = 0;
        this.dashTimer = 0;
        this.dashAngle = 0;
        
        // Animation variables
        this.frameX = 0; 
        this.frameY = 0; 
        this.walkDist = 0;      // ground covered on foot, drives the walk cycle
        
        // Bought upgrades outlive an Amnesia Potion; resetTalents rebuilds `buffs` from these.
        this.placing = null;              // building held for placement, if any
        this.intent = makeIntent();     // what this player wants; filled in by client or server
        this.shopBuffs = makeBuffs();
        this.resetTalents(true);
    }
    resetTalents(initial = false) {
        if (!initial) { this.tp += this.talents.length + this.paragonPoints; }
        this.talents = []; this.paragonPoints = 0; this.chosenPath = null;
        // Everything the talents added goes; everything bought stays.
        this.buffs = makeBuffs(this.shopBuffs);
        // Four talents (Quick Whirl, Fast Cast, Efficiency, Rapid Volley) write straight into
        // `data` rather than into a buff, and they leaked the same way: nothing put the
        // cooldown back, so buy/reset/rebuy ratcheted Meteor from 6s down to the 1s floor and
        // its cost from 40 mana to 9. Rebuilding from the class table is the whole fix, and it
        // is safe because those four are the only writers to `data` in the game.
        this.data = Object.assign({}, classDataInfo[this.cls]);
        // The day-speed boon is a transient rather than a talent, so it is put back if
        // it happens to be running - otherwise dusk would subtract a bonus nobody has.
        if (this.hasDaySpeed) this.buffs.speedMult += 1.0;
        this.whirlMod = 1.0; this.talentDmgReduc = 1.0; this.buildCostMod = 1.0; this.extractorBonus = 0;
        // Accumulated by talent ranks; read back in recalcStats so ranks stack cleanly.
        this.talentAtkBonus = 0; this.talentHpBonus = 0; this.talentMpBonus = 0;
        this.hpRegen = 0; this.burnBonus = 0; this.slowPower = 0.5;
        this.meteorMod = 1.0; this.attackSlows = false; this.meteorFreezes = false; this.mpRegenMod = 1.0;
        this.projSpeedMod = 1.0; this.chainBounces = 0; this.rainMod = 1.0;
        this.novaInvincibility = false; this.novaHealMod = 1.0; this.baseRegen = false; this.novaBeams = false;
        this.globalSlow = false;

        // Capstone Flags
        this.leapSlam = false; this.reflectHeals = false; this.killTribute = false;
        this.scorchedEarth = false; this.shatter = false; this.manaShield = false;
        this.piercingArrows = 0; this.rainSplinters = false;
        this.smite = false; this.overheal = false; this.novaBeamMult = 1.0;

        this.recalcStats();
    }
    recalcStats() {
        // 1.12 rather than 1.10: with the towers gone the player's own weapon is the only
        // damage curve in the game, so it has to climb closer to the horde's own 1.13.
        let baseA = this.data.atk * Math.pow(1.12, this.level - 1); let baseH = this.data.hp * Math.pow(1.15, this.level - 1);
        // Forge damage is additive off the class's base attack, not a multiplier on the
        // level-scaled value, so it no longer compounds with levels, talents and crit.
        this.atk = baseA + this.data.atk * (this.buffs.forgeAtkMult - 1);
        this.maxHp = baseH + this.buffs.bonusHp; this.maxMp = this.data.mp;
        this.atk *= (1 + this.talentAtkBonus);
        this.maxHp += this.talentHpBonus;
        this.maxMp += this.talentMpBonus;
        this.atk *= Math.pow(1.03, this.paragonPoints); this.maxHp *= Math.pow(1.05, this.paragonPoints);
        this.atk = Math.floor(this.atk); this.maxHp = Math.floor(this.maxHp); this.maxMp = Math.floor(this.maxMp);
        this.hp = Math.min(this.hp, this.maxHp); this.mp = Math.min(this.mp, this.maxMp);
        this.attackCd = this.data.cd * this.buffs.hasteMod;
        // Overcharge's five second window used to halve tower cooldowns and nothing else,
        // so with the towers gone it was a ring drawn on the ground. It now drives the only
        // weapon left: half the swing time and half again the damage while it burns.
        if (typeof world.base !== 'undefined' && world.base && world.base.overchargeActive > 0) {
            this.atk = Math.floor(this.atk * 1.5);
            this.attackCd *= 0.5;
        }

        this.dmgReduc = (this.cls === 'warrior' ? Math.max(0.5, 1.0 - (this.level * 0.02)) : 1.0) * this.talentDmgReduc * this.buffs.dmgReducMult;
    }
    gainXp(amount) {
        this.xp += amount;
        // `while`, not `if`: a single award can be worth more than one level. A cyclops
        // contract pays 360 against a 150 threshold, and with `if` the surplus just sat
        // banked - so levels were gated by how many things you killed rather than by the
        // experience you actually earned, and every boss and contract was short-changed.
        let gained = 0;
        while (this.xp >= this.maxXp) {
            this.level++; this.xp -= this.maxXp;
            this.maxXp = Math.floor(this.maxXp * TALENT_XP_GROWTH);
            this.tp += TP_PER_LEVEL;
            gained++;
        }
        if (gained > 0) {
            this.recalcStats(); this.hp = this.maxHp; this.mp = this.maxMp; playSound('levelup');
            world.entities.texts.push(new FloatingText(this.x, this.y - 40,
                gained > 1 ? "LEVEL UP x" + gained + "!" : "LEVEL UP!", '#ffcc00'));
        }
    }
    update(dt) {
        if (this.dashTimer > 0) {
            this.dashTimer -= dt;
            let speed = 1200 * dt; 
            let nextX = this.x + Math.cos(this.dashAngle) * speed;
            let nextY = this.y + Math.sin(this.dashAngle) * speed;
            if (!isCollidingWithObstacle(nextX, nextY, this.radius)) { this.x = nextX; this.y = nextY; } 
            else { if (!isCollidingWithObstacle(nextX, this.y, this.radius)) this.x = nextX; else if (!isCollidingWithObstacle(this.x, nextY, this.radius)) this.y = nextY; }
            if (Math.random() < 0.5) spawnParticles(this.x, this.y, '#fff', 1); 
        } else {
            let dx = 0, dy = 0;
            dx += this.intent.moveX; dy += this.intent.moveY;
            if (dx !== 0 || dy !== 0) {
                let len = Math.sqrt(dx*dx + dy*dy); 
                let speed = this.spd * this.buffs.speedMult * (world.currentWeather==='blizzard'?0.7:1) * (dt*60);
                let nextX = this.x + (dx/len) * speed; let nextY = this.y + (dy/len) * speed;
                let px = this.x, py = this.y;
                if (this.isFlying || !isCollidingWithObstacle(nextX, nextY, this.radius)) { this.x = nextX; this.y = nextY; }
                else { if (!isCollidingWithObstacle(nextX, this.y, this.radius)) this.x = nextX; else if (!isCollidingWithObstacle(this.x, nextY, this.radius)) this.y = nextY; }
                // Cadence comes from ground actually covered, not from a timer, so the feet
                // keep pace with Haste, Fleetfoot and a blizzard's slow alike - and they stop
                // dead when you walk into a tree instead of jogging on the spot.
                this.walkDist += Math.hypot(this.x - px, this.y - py);
            } else this.walkDist = 0;    // stood still, so the cycle restarts planted
        }

        this.x = Math.max(this.radius, Math.min(WORLD_W-this.radius, this.x)); this.y = Math.max(this.radius, Math.min(WORLD_H-this.radius, this.y));
        if (this.abTimer <= 0) this.angle = Math.atan2(this.intent.aimY - this.y, this.intent.aimX - this.x); else this.abTimer -= dt;
        if (this.abilityCooldownTimer > 0) this.abilityCooldownTimer -= dt;
        this.lastAttack -= dt;
        if (this.mp < this.maxMp) this.mp += dt * 2 * this.mpRegenMod * this.buffs.mpRegenBonus;
        if (this.hpRegen > 0 && this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + dt * this.hpRegen);
        if (this.invincibleTimer > 0) { this.invincibleTimer -= dt; this.invincible = true; } else { this.invincible = false; }
        if (this.shiftCd > 0) this.shiftCd -= dt;

        // Shift Utility Skill
        if (this.intent.dash && this.shiftCd <= 0 && this.dashTimer <= 0) {
            playSound('shoot');
            if (this.cls === 'mage' || this.cls === 'priest') {
                let dist = 250;
                let ang = Math.atan2(this.intent.aimY - this.y, this.intent.aimX - this.x);
                let targetX = this.x + Math.cos(ang) * dist;
                let targetY = this.y + Math.sin(ang) * dist;
                
                spawnParticles(this.x, this.y, this.data.color, 10);
                let steps = 10; let stepX = (targetX - this.x) / steps; let stepY = (targetY - this.y) / steps;
                for(let i=0; i<steps; i++) {
                    if(!isCollidingWithObstacle(this.x + stepX, this.y + stepY, this.radius)) {
                        this.x += stepX; this.y += stepY;
                    } else break;
                }
                this.x = Math.max(this.radius, Math.min(WORLD_W-this.radius, this.x)); this.y = Math.max(this.radius, Math.min(WORLD_H-this.radius, this.y));
                spawnParticles(this.x, this.y, this.data.color, 15);
            } else {
                this.dashTimer = 0.2;
                let dx = 0, dy = 0;
                dx += this.intent.moveX; dy += this.intent.moveY;
                if (dx !== 0 || dy !== 0) this.dashAngle = Math.atan2(dy, dx);
                else this.dashAngle = this.angle;
                this.invincibleTimer = Math.max(this.invincibleTimer || 0, 0.2); 
            }
            this.shiftCd = 3.0 * this.buffs.hasteMod;
        }

        // Overcharge only changes the numbers through recalcStats, so catch both edges of
        // the window - switching it on and letting it lapse - and rebuild the stats there.
        let ocNow = world.base && world.base.overchargeActive > 0;
        if (ocNow !== this.wasOvercharged) { this.wasOvercharged = ocNow; this.recalcStats(); }

        // Overcharge is a night-only button, so say so rather than swallowing the press.
        if (this.intent.overcharge && world.gameState !== 'NIGHT') {
            playSound('error');
            world.entities.texts.push(new FloatingText(this.x, this.y - 50, "THE NEXUS ONLY WAKES AT NIGHT", '#9a9a90'));
            this.intent.overcharge = false;
        }
        if (this.intent.overcharge && world.base.overchargeCd <= 0 && world.gameState === 'NIGHT') {
            world.base.overchargeActive = 5.0;
            world.base.overchargeCd = 45.0;
            // `this`, not the global: the nova is powered by whoever pressed the key.
            world.entities.effects.push(new Effect(world.base.x, world.base.y, 400, '#00ffff', 0.5, this.atk * 3, false, false, 'none', 'player'));
            addShake(20); playSound('explosion');
            world.entities.texts.push(new FloatingText(world.base.x, world.base.y - 80, "NEXUS OVERCHARGE!", '#00ffff'));
            this.wasOvercharged = true; this.recalcStats();   // take effect on this frame, not the next
            this.intent.overcharge = false;
        }

        if (this.intent.ability && this.mp >= this.data.abCost && this.abTimer <= 0 && this.abilityCooldownTimer <= 0) {
            this.useAbility(); this.abilityCooldownTimer = this.data.abCd * this.buffs.hasteMod; this.intent.ability = false;
        }
        if (this.intent.place && world.gameState === 'DAY') { this.placeBuilding(); this.intent.placeSpent = true; this.intent.place = false; }
        
        if (this.abTimer > 0 && this.cls === 'warrior') {
            this.angle += dt * 15; this.whirlTick -= dt;
            this.whirlSpin += dt * 15; this.whirlPulse = Math.max(0, this.whirlPulse - dt * 5);
            if (this.whirlTick <= 0) {
                world.entities.enemies.forEach(e => {
                    if (e.type === 'assassin' && e.isInvisible) return;
                    if (Math.hypot(e.x - this.x, e.y - this.y) < 100 * this.whirlMod) {
                        let dmgDealt = this.atk * 0.5;
                        e.takeDamage(dmgDealt, true, 'none', 'player');
                    }
                });
                this.whirlTick = 0.25; this.whirlPulse = 1;
            }
        }

        // STATIC ANIMATION LOGIC FOR ALL CLASSES
        let isMoving = (this.intent.moveX !== 0 || this.intent.moveY !== 0) && this.dashTimer <= 0;
        
        this.frameY = 0; // Only 1 row now!

        if (this.lastAttack > this.attackCd - ATTACK_ANIM_TIME) {
            this.frameX = 2; // Attack pose (3rd column)
        } else if (isMoving) {
            this.frameX = 1; // Walk pose (2nd column)
        } else {
            this.frameX = 0; // Idle pose (1st column)
        }
    }

    // Horizontal counterpart to visualMidY. The sprite CELL is centred on the origin, but the
    // art inside the cell need not be: the priest's idle pose stands with his staff out to one
    // side, which pushes his body 7px off the anchor. Measured off the drawn sprite rather than
    // eyeballed - for each row take the longest contiguous run of opaque pixels, which is the
    // torso since a staff is a separate and shorter run, then the median across rows, which
    // shrugs off the rows where an outstretched arm is the longest thing. His walk frames came
    // back at +1.5 and -2.5, so only the idle pose needs correcting.
    //
    // Multiplied by facing, because the sprite is mirrored when you aim left: a fixed offset
    // would be right half the time and twice as wrong the other half.
    visualMidX() {
        let per = BODY_OFFSET_X[this.cls];
        let off = per ? (per[this.frameX] || 0) : 0;
        return off * (this.intent.aimX < this.x ? -1 : 1);
    }

    // The player's origin sits at the feet, not the middle of the figure, so anything meant to
    // be centred ON the caster has to be placed here instead. Measured rather than eyeballed:
    // the walk frames' bounding boxes centre on y -8 to -9.5, and feet - h/2 lands on -9.
    // Derived from the sprite metrics rather than typed in, so it survives a re-scale of the
    // art. Horizontal needs no correction - those same frames centre on x -0.5 - and a fixed
    // x offset would be wrong half the time anyway, because the sprite flips with facing.
    visualMidY() {
        let set = HERO_WALK[this.cls];
        return set ? set.feet - set.h / 2 : 0;
    }

    // Which frame of a drawn attack sequence to show. The window is capped at the attack
    // cooldown so a hasted warrior plays the whole swing faster instead of stalling on the
    // wind-up and never reaching the arc.
    attackFrame(count) {
        let window = Math.min(ATTACK_ANIM_TIME, this.attackCd);
        if (window <= 0) return count - 1;
        let elapsed = this.attackCd - this.lastAttack;
        return Math.max(0, Math.min(count - 1, Math.floor((elapsed / window) * count)));
    }
    
    useAbility() {
        this.mp -= this.data.abCost; playSound('shoot');
        if (this.cls === 'warrior') { 
            if (this.leapSlam) { 
                this.x = Math.max(this.radius, Math.min(WORLD_W-this.radius, this.intent.aimX));
                this.y = Math.max(this.radius, Math.min(WORLD_H-this.radius, this.intent.aimY));
                world.entities.effects.push(new Effect(this.x, this.y, 100, '#ff4d4d', 0.2, 0, false, false, 'none', 'player')); 
                addShake(10); 
                this.invincibleTimer = 0.5;
            }
            this.abTimer = 1.5; this.abMaxTimer = 1.5; this.whirlTick = 0; this.whirlSpin = 0; this.whirlPulse = 0;
        } 
        else if (this.cls === 'mage') { 
            world.entities.effects.push(new Effect(this.intent.aimX, this.intent.aimY, 150 * this.meteorMod, '#ff6600', 1.0, this.atk * 3, this.meteorFreezes, false, 'fire', 'player', 'meteor')); 
            if (this.scorchedEarth) world.entities.effects.push(new Effect(this.intent.aimX, this.intent.aimY, 150 * this.meteorMod, '#ff3300', 5.0, this.atk * 0.5, false, true, 'fire', 'player', 'scorched'));
            addShake(15); 
        } 
        else if (this.cls === 'archer') {
            // Rain of Arrows: a volley that keeps falling on the marked ground.
            let r = RAIN_RADIUS * this.rainMod;
            world.entities.effects.push(new Effect(this.intent.aimX, this.intent.aimY, r, '#4dff4d', RAIN_DURATION, this.atk * RAIN_TICK_DMG, false, true, 'none', 'player', 'arrowrain'));
            if (this.rainSplinters) {
                for (let i = 0; i < RAIN_SPLINTERS; i++) {
                    let a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
                    world.entities.projectiles.push(new Projectile(this.intent.aimX + Math.cos(a)*d, this.intent.aimY + Math.sin(a)*d, 0, 0, this.atk * 1.5, true, '#ffaa00', 0, false, 0, true, 'fire', 'player'));
                }
            }
            addShake(6);
        }else if (this.cls === 'priest') {
            // The heal scales off novaHealMod and the Judgment beams off atk, but the burst
            // itself was a hardcoded 50 - by wave 20 that is a seventh of a goblin. At 2.5x
            // attack it opens slightly above the old flat number and then keeps up, while
            // staying under the pure-damage ults because this one heals as well.
            let healAmt = 50 * this.novaHealMod;
            // Placed on the caster's visual middle, not their origin, so the priest stands in
            // the centre of his own circle instead of a head low in it. Offsetting the effect
            // itself rather than just the drawing keeps the circle you see and the circle that
            // heals and hits as one and the same.
            world.entities.effects.push(new Effect(this.x + this.visualMidX(), this.y + this.visualMidY(), 250, '#ffffcc', 0.5, this.atk * 2.5, false, false, 'none', 'player', 'holynova'));
            
            let applyHeal = (ent, amt) => {
                if (ent.hp >= ent.maxHp && this.overheal) ent.shield = Math.min(ent.maxHp, ent.shield + amt);
                ent.hp = Math.min(ent.maxHp, ent.hp + amt);
            };
            
            applyHeal(this, healAmt);
            if (Math.hypot(this.x - world.base.x, this.y - world.base.y) < 250) applyHeal(world.base, healAmt*2);
            if (this.novaInvincibility) this.invincibleTimer = 3.0;
            if (this.novaBeams) world.entities.enemies.forEach(e => {
                if (e.type === 'assassin' && e.isInvisible) return;
                if (Math.hypot(e.x - this.x, e.y - this.y) < 250) world.entities.effects.push(new Effect(e.x, e.y, 40, '#ffe666', 0.3, this.atk * 2 * this.novaBeamMult, false, false, 'none', 'player'));
            });
            addShake(8);
        }
    }

    attack() {
        if (this.lastAttack > 0) return;
        playSound('shoot');
        if (this.data.type === 'melee') {
            let reachX = this.x + Math.cos(this.angle) * 40, reachY = this.y + Math.sin(this.angle) * 40;
            world.entities.effects.push(new Effect(reachX, reachY, this.data.range, '#ffffff', 0.2));
            world.entities.enemies.forEach(e => { 
                if (e.type === 'assassin' && e.isInvisible) return;
                if (Math.hypot(e.x - reachX, e.y - reachY) < this.data.range) { 
                    let dmgDealt = this.atk;
                    e.takeDamage(dmgDealt, true, 'none', 'player'); spawnParticles(e.x, e.y, '#fff', 3); 
                } 
            });
            // Wildlife is fair game, and gets no say in it beyond running.
            world.entities.critters.forEach(c => {
                if (Math.hypot(c.x - reachX, c.y - reachY) < this.data.range + c.radius) c.takeDamage(this.atk);
            });
        } else {
            let vx = Math.cos(this.angle) * 12 * this.projSpeedMod, vy = Math.sin(this.angle) * 12 * this.projSpeedMod;
            if (this.smite) { vx *= 5; vy *= 5; } 
            let el = (this.cls === 'mage') ? (this.attackSlows ? 'ice' : 'fire') : 'none';
            world.entities.projectiles.push(new Projectile(this.x, this.y, vx, vy, this.atk, true, this.data.color, this.chainBounces, this.attackSlows, this.piercingArrows, this.smite, el, 'player', this));
        }
        this.lastAttack = this.attackCd;
    }

    // Places whatever the Buildings window armed. Every rejection happens before a single
    // resource is spent, so a blocked spot never costs you the materials.
    placeBuilding() {
        if (!this.placing) return;
        let key = this.placing, b = BUILDINGS[key], c = buildingCost(key);
        let mx = this.intent.aimX, my = this.intent.aimY;
        let deny = (msg) => { playSound('error'); world.entities.texts.push(new FloatingText(mx, my - 20, msg, '#ff4d4d')); };

        if (b.count() >= b.max) { deny(b.name.toUpperCase() + " LIMIT " + b.count() + "/" + b.max); return; }
        if (!canAfford(c)) { deny("NOT ENOUGH RESOURCES!"); return; }

        // Everything already standing needs elbow room, and nothing goes inside the Nexus.
        let clash = world.entities.extractors.some(t => Math.hypot(t.x - mx, t.y - my) < EXTRACTOR_SPACING)
                 || (world.forgeBuilding && Math.hypot(world.forgeBuilding.x - mx, world.forgeBuilding.y - my) < EXTRACTOR_SPACING);
        if (clash || Math.hypot(world.base.x - mx, world.base.y - my) < NEXUS_KEEPOUT || isCollidingWithObstacle(mx, my, 30)) { deny("BLOCKED"); return; }

        world.inventory.wood -= c.w; world.inventory.stone -= c.s; world.inventory.mana -= c.m;
        if (key === 'extractor') {
            world.entities.extractors.push(new Extractor(mx, my));
            world.gameStats.extractors++; if (world.gameStats.extractors === 3) checkAchievement('builder');
        } else {
            world.forgeBuilding = { x: mx, y: my };
            world.entities.texts.push(new FloatingText(mx, my - 60, "THE FORGE IS LIT", '#ffcc66'));
        }
        this.placing = null;
        spawnParticles(mx, my, '#fff', 18); playSound('levelup'); addShake(6); ui.buildPalette();
    }

}

// The last buildable structure. It is economy, not defence: it produces during the day,
// sits inert at night, and enemies will break it if they walk into it.
export class Extractor extends Entity {
    constructor(x, y) {
        super(x, y, 30, EXTRACTOR_HP);
        this.tick = 0;
    }
    update(dt) {
        this.tick -= dt;
        if (world.gameState === 'DAY' && this.tick <= 0) {
            // Shared building: the party's best prospector sets the yield.
        let n = 2 + world.players.reduce((best, p) => Math.max(best, p.extractorBonus || 0), 0);
            world.inventory.wood += n; world.inventory.stone += n;
            world.entities.texts.push(new FloatingText(this.x, this.y - 20, "+" + (n * 2) + " Res", '#ffcc00'));
            playSound('pickup');
            this.tick = 4.0;
        }
    }
}

export class Projectile {
    constructor(x, y, vx, vy, dmg, isFriendly, color, chainCount=0, slows=false, pierceCount=0, isExplosive=false, element='none', source='player', owner=null) {
        this.owner = owner || (isFriendly ? nearestPlayer(x, y) : null);
        this.x = x; this.y = y; this.vx = vx; this.vy = vy; this.dmg = dmg; this.isFriendly = isFriendly; this.color = color; this.life = 2.0; this.markedForDeletion = false; this.chain = chainCount; this.slows = slows; this.pierce = pierceCount; this.isExplosive = isExplosive; this.element = element; this.source = source; this.hitList = [];
    }
    update(dt) {
        this.x += this.vx * (dt*60); this.y += this.vy * (dt*60); this.life -= dt; if(this.life <= 0) this.markedForDeletion = true;
        if(this.isFriendly) {
            world.entities.critters.forEach(c => {
                if (!this.markedForDeletion && Math.hypot(c.x - this.x, c.y - this.y) < c.radius + 10 && !this.hitList.includes(c)) {
                    c.takeDamage(this.dmg); this.hitList.push(c);
                    spawnParticles(this.x, this.y, this.color, 4);
                    if (!this.pierce) this.markedForDeletion = true;
                }
            });
            world.entities.enemies.forEach(e => {
                if (!this.markedForDeletion && Math.hypot(e.x - this.x, e.y - this.y) < e.radius + 10 && !this.hitList.includes(e)) {
                    let dmgDealt = this.dmg;
                    const shooter = this.owner || nearestPlayer(this.x, this.y);
                    if (shooter && shooter.shatter && (e.spd < e.baseSpd || e.frozenTimer > 0)) { dmgDealt *= 3; e.spd = e.baseSpd; e.frozenTimer = 0; world.entities.texts.push(new FloatingText(e.x, e.y, "SHATTER!", '#00ffff')); }
                    
                    e.takeDamage(dmgDealt, true, this.element, this.source); this.hitList.push(e); spawnParticles(this.x, this.y, this.color, 4);
                    if (this.slows) e.spd = e.baseSpd * ((shooter && shooter.slowPower) || 0.5);if (shooter && shooter.cls === 'mage' && !this.isExplosive) world.entities.effects.push(new Effect(this.x, this.y, 50, '#ff9900', 0.2, 10, false, false, 'fire', this.source));
                    
                    if (this.isExplosive) {
                        world.entities.effects.push(new Effect(this.x, this.y, 80, '#ffaa00', 0.2, this.dmg, false, false, 'fire', this.source)); playSound('explosion'); addShake(3);
                        this.markedForDeletion = true;
                    } else {
                        // Ricochet first, pierce as the fallback. Pierce used to win outright,
                        // which left Chain Shot doing nothing for anyone who also took the capstone.
                        let nearest = null;
                        if (this.chain > 0) {
                            let minDist = 250;
                            world.entities.enemies.forEach(ne => {
                                if (ne.isAsleep || (ne.type === 'assassin' && ne.isInvisible)) return;
                                if (!this.hitList.includes(ne)) { let d = Math.hypot(ne.x - this.x, ne.y - this.y); if (d < minDist) { minDist = d; nearest = ne; } }
                            });
                        }
                        if (nearest) {
                            this.chain--;
                            let angle = Math.atan2(nearest.y - this.y, nearest.x - this.x); let speed = Math.hypot(this.vx, this.vy);
                            this.vx = Math.cos(angle) * speed; this.vy = Math.sin(angle) * speed;
                            this.life = Math.max(this.life, 0.6); // don't let a bounce die in flight
                        } else if (this.pierce > 0) {
                            this.pierce--;
                        } else { this.markedForDeletion = true; }
                    }
                }
            });
        } else {
            const struck = world.players.find(p => p.hp > 0 && Math.hypot(p.x - this.x, p.y - this.y) < p.radius + 5);
            if (struck) { struck.takeDamage(this.dmg); this.markedForDeletion = true; playSound('hit'); } 
            else if (Math.hypot(world.base.x - this.x, world.base.y - this.y) < world.base.radius + 5) { world.base.takeDamage(this.dmg); this.markedForDeletion = true; playSound('hit'); }
        }
    }
}

export class Enemy extends Entity {
    constructor(x, y, type) {
        // 1.15 compounded against a tower line that grew every wave. On foot alone it ran
        // away from the player's own curve, so it is 1.13 - the same shape, a slower climb.
        let baseHPMult = Math.pow(1.13, world.wave - 1);
        let startHp = Math.floor(35 * baseHPMult);
        super(x, y, type==='orcking'? KING_RADIUS : (type==='cyclop'? CYCLOP_RADIUS : (type==='troll'? TROLL_RADIUS : (type==='orcrider'? RIDER_RADIUS :
            (type==='goblinarcher'? GOB_RADIUS : (type==='boss'? 40 : (type==='golem'? 25 : (type==='predator'? 45 : 15))))))), startHp);
        this.type = type; this.baseSpd = 1.5 + (world.wave * 0.1); this.isFlying = (type === 'harpy');
        this.spawnPhase = Math.random() * 6.283;
        this.isAsleep = false;
        this.isInvisible = false;
        this.bossPhaseTriggered = false;
        this.burningTimer = 0;
        this.animTimer = 0;
        this.frameX = 0;
        this.distanceTraveled = 0;

        if (this.type === 'orcarcher') {this.hp *= 0.6; this.baseSpd *= 0.9; }
        if (this.type === 'golem') { this.hp *= 3; this.baseSpd *= 0.5; }
        if (this.type === 'boss') { this.hp *= 10; this.baseSpd *= 0.8; }
        if (this.type === 'orcking') { this.hp *= KING_HP_MULT; this.baseSpd *= KING_SPD_MULT; this.slamCd = KING_SLAM_CD; this.enraged = false; }
        if (this.type === 'harpy') { this.hp *= HARPY_HP_MULT; this.baseSpd *= HARPY_SPD_MULT; }
        if (this.type === 'goblinarcher') { this.hp *= GOB_HP_MULT; this.baseSpd *= GOB_SPD_MULT; }
        if (this.type === 'cyclop') { this.hp *= CYCLOP_HP_MULT; this.baseSpd *= CYCLOP_SPD_MULT; this.smashCd = 1.5; }
        if (this.type === 'troll') { this.hp *= TROLL_HP_MULT; this.baseSpd *= TROLL_SPD_MULT; }
        if (this.type === 'orcrider') { this.hp *= RIDER_HP_MULT; this.baseSpd *= RIDER_SPD_MULT; this.charge = 0; this.wheelTimer = 0; }
        if (this.type === 'bomber') { this.hp *= 0.8; this.baseSpd *= 1.2; }
        if (this.type === 'predator') { this.hp = Math.floor(PREDATOR_BASE_HP * Math.pow(PREDATOR_HP_GROWTH, world.wave - 1)); this.baseSpd = 4 + Math.min(world.wave - 1, 10) * 0.06; this.isAsleep = true; }
        if (this.type === 'assassin') { this.hp *= 0.5; this.baseSpd *= 1.8; this.isInvisible = true; }
        if (this.type === 'necromancer') { this.hp *= 0.8; this.baseSpd *= 0.7; this.healCd = 2.0; this.castAnim = 0; }
        if (this.type === 'wolf') { this.hp *= 0.7; this.baseSpd *= 1.4; }
        
        if (this.type === 'golem') {
            this.aura = 'speed';        // a war-drum, never a medic
            this.auraPulse = 0;
        } else if (this.type === 'boss' || this.type === 'orcking') {
            // One boss against a party melts. It gets the health the extra bodies would
            // have carried, rather than the party getting a second boss.
            this.hp = Math.floor(this.hp * coopToughMult());
            this.aura = rnd() > 0.5 ? 'heal' : 'speed';
            this.auraPulse = 0;
        } else {
            this.aura = 'none';
        }
        
        if (world.currentWeather === 'bloodmoon') { this.baseSpd *= 1.5; }

        this.spd = this.baseSpd; 
        let baseDmg = this.type === 'orcking' ? KING_DMG_BASE : (this.type === 'cyclop' ? CYCLOP_DMG_BASE :
                      (this.type === 'troll' ? TROLL_DMG_BASE : (this.type === 'orcrider' ? RIDER_DMG_BASE : (this.type === 'boss' ? 20 : (this.type === 'predator' ? 40 :
                      (this.type === 'goblinarcher' ? 5 * GOB_DMG_MULT : (this.type === 'wolf' ? 8 : 5)))))));
        this.dmg = Math.floor(baseDmg * Math.pow(1.1, world.wave - 1)); 
        this.attackCd = 1.0; this.flashAnim = 0; this.frozenTimer = 0; this.freezeImmuneTimer = 0; this.aggroTimer = 0; this.stuckTimer = 0;
        this.maxHp = this.hp;
    }
    // A rider's blow is worth whatever speed it carried into contact.
    hitPower() {
        if (this.type !== 'orcrider') return this.dmg;
        return Math.floor(this.dmg * (1 + this.charge * (RIDER_CHARGE_DMG - 1)));
    }
    // Spend the charge on impact: a real one sends the rider past its target to come
    // around again, a half-hearted one just resets.
    spendCharge() {
        if (this.type !== 'orcrider') return;
        if (this.charge >= RIDER_CHARGE_LAND) {
            this.wheelTimer = RIDER_WHEEL;
            spawnParticles(this.x, this.y, '#c9b98a', 14); addShake(7);
        }
        this.charge = 0;
    }
    update(dt) {
        if (this.freezeImmuneTimer > 0) this.freezeImmuneTimer -= dt;
        if (this.frozenTimer > 0) { this.frozenTimer -= dt; return; }
        if (this.burningTimer > 0) {
            this.burningTimer -= dt;
            if (Math.random() < 0.1) spawnParticles(this.x, this.y, '#ff6600', 1);
        }

        // Trolls knit themselves back together unless they are on fire.
        if (this.type === 'troll' && this.hp > 0 && this.hp < this.maxHp && this.burningTimer <= 0) {
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * TROLL_REGEN * dt);
        }

        if (this.isAsleep) {
            return; 
        }
        
        // The enemy's idea of "the player" is whoever is nearest to it, resolved once a
        // tick and reused below so every decision in this update agrees on one target.
        let targetPlayer = nearestPlayer(this.x, this.y);
        let distPlayer = targetPlayer ? Math.hypot(targetPlayer.x - this.x, targetPlayer.y - this.y) : Infinity;
        if (this.type === 'assassin') {
            this.isInvisible = distPlayer > 150 && this.frozenTimer <= 0 && this.burningTimer <= 0 && this.flashAnim <= 0;
        }

        if (this.type === 'orcking') {
            this.slamCd -= dt;
            let slamTarget = distPlayer < KING_SLAM_RANGE ? targetPlayer
                           : (Math.hypot(world.base.x - this.x, world.base.y - this.y) < KING_SLAM_RANGE + world.base.radius ? world.base : null);
            if (this.slamCd <= 0 && slamTarget) {
                // Axe comes down: everything nearby takes a hit, extractors included.
                this.slamCd = KING_SLAM_CD * (this.enraged ? 0.6 : 1.0);
                this.frameX = 2; this.animTimer = 0;
                world.entities.effects.push(new Effect(this.x, this.y, KING_SLAM_RANGE, '#ff7b2e', 0.45, 0, false, false, 'none', 'enemy'));
                let slam = Math.floor(this.dmg * KING_SLAM_DMG);
                playersInRange(this.x, this.y, KING_SLAM_RANGE).forEach(p => p.takeDamage(slam, false, 'none', 'player', this));
                if (Math.hypot(world.base.x - this.x, world.base.y - this.y) < KING_SLAM_RANGE + world.base.radius) world.base.takeDamage(slam);
                world.entities.extractors.forEach(t => { if (Math.hypot(t.x - this.x, t.y - this.y) < KING_SLAM_RANGE) t.takeDamage(slam); });
                spawnParticles(this.x, this.y, '#c98a3c', 26);
                playSound('explosion'); addShake(22);
            }
            if (!this.enraged && this.hp < this.maxHp * 0.5) {
                this.enraged = true; this.baseSpd *= 1.5; this.spd = this.baseSpd;
                world.entities.texts.push(new FloatingText(this.x, this.y - 140, "ENRAGED!", '#ff3b3b'));
                playSound('explosion'); addShake(25);
                for (let i = 0; i < 20; i++) {
                    let ang = (Math.PI * 2 / 20) * i;
                    world.entities.projectiles.push(new Projectile(this.x, this.y, Math.cos(ang)*7, Math.sin(ang)*7, this.dmg, false, '#ffaa00'));
                }
            }
        }
        if (this.type === 'cyclop') {
            this.smashCd -= dt;
            let hitsPlayer = distPlayer < CYCLOP_SMASH;
            let hitsBase = Math.hypot(world.base.x - this.x, world.base.y - this.y) < CYCLOP_SMASH + world.base.radius;
            if (this.smashCd <= 0 && (hitsPlayer || hitsBase)) {
                // The club comes down and the ground goes with it - extractors included.
                this.smashCd = CYCLOP_SMASH_CD;
                this.frameX = 2; this.animTimer = 0;
                world.entities.effects.push(new Effect(this.x, this.y, CYCLOP_SMASH, '#d8a24a', 0.35, 0, false, false, 'none', 'enemy'));
                let blow = Math.floor(this.dmg * 1.1);
                playersInRange(this.x, this.y, CYCLOP_SMASH).forEach(p => p.takeDamage(blow, false, 'none', 'player', this));
                if (hitsBase) world.base.takeDamage(blow);
                world.entities.extractors.forEach(t => { if (Math.hypot(t.x - this.x, t.y - this.y) < CYCLOP_SMASH) t.takeDamage(blow); });
                spawnParticles(this.x, this.y, '#c98a3c', 16);
                playSound('explosion'); addShake(11);
            }
        }
        if (this.type === 'boss' && this.hp < this.maxHp * 0.5 && !this.bossPhaseTriggered) {
            this.bossPhaseTriggered = true;
            playSound('explosion'); addShake(15);
            for(let i=0; i<16; i++) {
                let ang = (Math.PI * 2 / 16) * i;
                world.entities.projectiles.push(new Projectile(this.x, this.y, Math.cos(ang)*8, Math.sin(ang)*8, this.dmg * 1.5, false, '#ffaa00'));
            }
        }
        
        world.entities.enemies.forEach(other => {
            if (this !== other && this.type !== 'boss' && other.type !== 'boss' && this.type !== 'orcking' && other.type !== 'orcking') {
                let edx = this.x - other.x; let edy = this.y - other.y; let edist = Math.hypot(edx, edy);
                if (edist < this.radius + other.radius && edist > 0) { this.x += (edx / edist) * 0.5; this.y += (edy / edist) * 0.5; }
            }
        });

        let distBase = Math.hypot(world.base.x - this.x, world.base.y - this.y);
        if (this.aggroTimer > 0) this.aggroTimer -= dt;
        let aggroRange = this.type === 'golem' ? AGGRO_RANGE_GOLEM : AGGRO_RANGE;
        if (distPlayer < aggroRange) this.aggroTimer = AGGRO_HOLD;           // you walked into it
        // Hold the grudge until you break well clear, so they don't flip-flop each step.
        let onPlayer = this.aggroTimer > 0 && distPlayer < aggroRange * AGGRO_DROP;
        if (!onPlayer) this.aggroTimer = 0;
        let target = onPlayer ? targetPlayer : (distBase < distPlayer ? world.base : targetPlayer);
        if (target !== this._lastTarget) { this._lastTarget = target; this.stuckTimer = 0; }
        
        if (this.type === 'necromancer') {
            let healTarget = null;
            let lowestHpRatio = 1.0;
            world.entities.enemies.forEach(e => {
                if (e === this || e.markedForDeletion || e.hp >= e.maxHp) return;
                if (e.hp / e.maxHp < lowestHpRatio) {
                    lowestHpRatio = e.hp / e.maxHp;
                    healTarget = e;
                }
            });
            if (healTarget) {
                target = healTarget;
            }
        }


        let dx = target.x - this.x; let dy = target.y - this.y; let len = Math.hypot(dx, dy);
        let stopDist = this.type === 'orcarcher' ? 300 : (this.type === 'goblinarcher' ? GOB_RANGE :(this.type === 'necromancer' && !world.players.includes(target) && target !== world.base ? 200 : this.radius + (target.radius || 0)));
        
        if (len > stopDist) {
            let speed = this.spd * (dt*60); 
            if (this.isFlying) { 
                let nextX = this.x + (dx/len) * speed; let nextY = this.y + (dy/len) * speed;
                this.distanceTraveled += Math.hypot(nextX - this.x, nextY - this.y);
                this.x = nextX; this.y = nextY;
                this.stuckTimer = 0;                 // nothing on the ground can pen a flier in
            } else {
                // Improved Avoidance: Sweep multiple angles if direct path is blocked by obstacles
                let baseAngle = Math.atan2(dy, dx);
                let moved = false;
                let anglesToTry = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.57, -1.57, 2.0, -2.0];
                for (let offset of anglesToTry) {
                    let testAngle = baseAngle + offset;
                    let testX = this.x + Math.cos(testAngle) * speed;
                    let testY = this.y + Math.sin(testAngle) * speed;
                    if (!isCollidingWithObstacle(testX, testY, this.radius)) {
                        this.distanceTraveled += Math.hypot(testX - this.x, testY - this.y);
                        this.x = testX;
                        this.y = testY;
                        moved = true;
                        break;
                    }
                }
                // A sweep that finds nothing means it is wedged in scenery, which is a
                // different thing from having arrived - the rider's charge reads this to
                // know it has nowhere to run. It drains twice as fast as it fills, so
                // clipping one trunk in passing does not count as being penned in.
                if (moved) this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
                else this.stuckTimer = Math.min(2, this.stuckTimer + dt);
            }
        } else {
            this.stuckTimer = 0;                     // standing at its target, not stuck
        }
        
        let auraSpeedMult = 1.0;
        world.entities.enemies.forEach(other => {
            if (other !== this && other.aura === 'speed' && Math.hypot(this.x - other.x, this.y - other.y) < 200) {
                auraSpeedMult = 1.5;
            }
        });
        this.spd = this.baseSpd * (world.players.some(p => p.globalSlow) ? 0.8 : 1.0) * auraSpeedMult;

        if (this.type === 'orcrider') {
            // A rising stuckTimer means it is jammed against something, and a rider with
            // nowhere to run is not charging anything - that also stops a penned warband
            // from battering walls down at charge damage.
            if (this.wheelTimer > 0) { this.wheelTimer -= dt; this.charge = 0; }
            else if (len > RIDER_CHARGE_MIN && this.stuckTimer <= 0) this.charge = Math.min(1, this.charge + dt / RIDER_CHARGE_TIME);
            else this.charge = Math.max(0, this.charge - dt * 0.5);
            this.spd *= 1 + this.charge * (RIDER_CHARGE_SPD - 1);
            if (this.charge > 0.6 && Math.random() < 0.25) spawnParticles(this.x, this.y + RIDER_FEET - 8, '#8a7a5a', 1);
        }
        
        if (this.type === 'bomber') this.flashAnim += dt * 5; 
        else if (this.flashAnim > 0) this.flashAnim -= dt;

        if (this.aura === 'heal') {
            this.auraPulse -= dt;
            if (this.auraPulse <= 0) {
                world.entities.enemies.forEach(other => {
                    if (Math.hypot(this.x - other.x, this.y - other.y) < 200 && other.hp < other.maxHp) {
                        other.hp = Math.min(other.maxHp, other.hp + (other.maxHp * 0.05));
                        world.entities.effects.push(new Effect(other.x, other.y, other.radius + 10, '#00ff00', 0.3));
                    }
                });
                this.auraPulse = 2.0;
            }
        }

        if (this.type === 'necromancer' && !world.players.includes(target) && target !== world.base) {
            if (len <= 250) {
                this.healCd -= dt;
                if (this.healCd <= 0) {
                    this.castAnim = 0.7;
                    target.hp = Math.min(target.maxHp, target.hp + target.maxHp * HEAL_FRACTION);
                    world.entities.effects.push(new Effect(target.x, target.y, 40, '#00ff00', 0.5));
                    playSound('pickup');
                    this.healCd = 2.0;
                }
            }
            // It takes no other action, but it still has to be animated - the shared
            // animation block below sits past this return.
            this.animTimer += dt;
            if (this.castAnim > 0) { this.castAnim -= dt; this.frameX = 2; }
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 34) % 2;
            return; 
        }

        this.attackCd -= dt;
        if (this.attackCd <= 0) {
            let orcInMelee = this.type === 'orcarcher' && distPlayer < ORC_MELEE_RANGE;
            let gobInMelee = this.type === 'goblinarcher' && distPlayer < GOB_MELEE_RANGE;
            if (this.type === 'orcarcher' && len <= 350 && !orcInMelee) {
                let angle = Math.atan2(dy, dx); world.entities.projectiles.push(new Projectile(this.x, this.y, Math.cos(angle)*8, Math.sin(angle)*8, this.dmg, false, '#ff0000'));
                this.attackCd = 2.0; playSound('shoot');
            } else if (this.type === 'goblinarcher' && len <= GOB_RANGE + 40 && !gobInMelee) {
                let angle = Math.atan2(dy, dx); world.entities.projectiles.push(new Projectile(this.x, this.y, Math.cos(angle)*9, Math.sin(angle)*9, this.dmg, false, '#cfe36b'));
                this.attackCd = GOB_SHOT_CD; playSound('shoot');
            } else if ((distPlayer < this.radius + 20 || orcInMelee || gobInMelee) && this.type !== 'golem' && this.type !== 'necromancer') { 
                if (this.type === 'bomber') { this.hp = 0; this.takeDamage(0); } else {
                    const victim = targetPlayer;
                    victim.takeDamage(this.hitPower(), false, 'none', 'player', this);
                    if (this.type === 'orcrider' && this.charge >= RIDER_CHARGE_LAND) {
                        // Ridden down: shoved along the line of the charge, but never into
                        // scenery and never off the map.
                        let a = Math.atan2(victim.y - this.y, victim.x - this.x);
                        let nx = clampWorld(victim.x + Math.cos(a) * RIDER_KNOCKBACK, WORLD_W, 40);
                        let ny = clampWorld(victim.y + Math.sin(a) * RIDER_KNOCKBACK, WORLD_H, 40);
                        if (!isCollidingWithObstacle(nx, ny, victim.radius)) { victim.x = nx; victim.y = ny; }
                    }
                    this.spendCharge();
                    this.attackCd = 1.0; if(this.type === 'boss') addShake(5); playSound('hit'); }
            } else if (distBase < this.radius + world.base.radius + 10) { 
                if (this.type === 'bomber') { this.hp = 0; this.takeDamage(0); } else { world.base.takeDamage(this.type === 'golem' ? this.dmg * 2 : this.hitPower()); this.spendCharge(); this.attackCd = 1.0; if(this.type === 'boss') addShake(8); playSound('hit'); }
            } else {
                world.entities.extractors.forEach(t => {
                    if (Math.hypot(t.x - this.x, t.y - this.y) < this.radius + 25) {
                        if (this.type === 'bomber') { this.hp = 0; this.takeDamage(0); }
                        else { t.takeDamage(this.type === 'golem' ? this.dmg * 2 : this.hitPower()); this.spendCharge(); this.attackCd = 1.0;
                            if (this.type === 'boss') addShake(3); playSound('hit');
                        }
                    }
                });
            }
        }

        this.animTimer += dt;
        if (this.type === 'orcking') {
            // Hold the overhead swing briefly after a slam, otherwise walk.
            if (this.animTimer < 0.5 && this.frameX === 2) { /* keep the swing */ }
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 45) % 2;
        }
        if (this.type === 'cyclop') {
            if (this.animTimer < 0.45 && this.frameX === 2) { /* keep the swing */ }
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 40) % 2;
        }
        if (this.type === 'harpy') {
            // Wings beat on their own clock - it never stops flying.
            if (this.attackCd > 0.7) this.frameX = 2;
            else this.frameX = Math.floor(this.animTimer * 7) % 2;
        }
        if (this.type === 'troll') {
            if (this.attackCd > 0.75) this.frameX = 2;
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 36) % 2;
        }
        if (this.type === 'golem' || this.type === 'boss') {
            // Two walk poses, and the swing held while the attack is on cooldown.
            if (this.attackCd > 0.72) this.frameX = 2;
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 42) % 2;
        }
        if (this.type === 'assassin') {
            if (this.attackCd > 0.75) this.frameX = 2;
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 26) % 2;   // quick feet
        }
        if (this.type === 'necromancer') {
            // Frame 2 is the channelling pose - held for a beat after a heal actually
            // lands, so a lit staff means it is doing something right now. Keying it off
            // healCd instead left it channelling forever whenever it had nothing to heal.
            if (this.castAnim > 0) { this.castAnim -= dt; this.frameX = 2; }
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 34) % 2;
        }
        if (this.type === 'bomber') {
            // The third frame is the detonation itself, so it is held for the run-in
            // rather than the moment of death - you get a beat of warning.
            let near = Math.min(nearestPlayerDist(this.x, this.y),
                                Math.hypot(world.base.x - this.x, world.base.y - this.y) - world.base.radius);
            if (near < BOMBER_FUSE) this.frameX = 2;
            else this.frameX = Math.floor((this.distanceTraveled || 0) / 28) % 2;
        }
        if (this.type === 'orcrider') {
            if (this.attackCd > 0.72) this.frameX = 2;           // axe coming down
            else if (this.charge > 0.35) this.frameX = 1;        // warg at full stretch
            else this.frameX = 0;
        }
        if (this.type === 'goblinarcher') {
            // Same rule as the orc archer: bow at range, wolf's teeth up close.
            if (distPlayer < GOB_MELEE_RANGE) this.frameX = 2;
            else if (this.attackCd > GOB_SHOT_CD * 0.55) this.frameX = 1;
            else this.frameX = 0;
        }
        if (this.type === 'orcarcher') {
            // Just loosed an arrow -> drawing pose; enemy in its face -> swing; else idle.
            if (distPlayer < ORC_MELEE_RANGE) this.frameX = 2;
            else if (this.attackCd > 1.2) this.frameX = 1;
            else this.frameX = 0;
        }
        if (this.type === 'goblin' || this.type === 'wolf') {
            if (this.attackCd > 0.8) {
                this.frameX = 2;
            } else {
                this.frameX = Math.floor((this.distanceTraveled || 0) / 30) % 2;
            }
        }
        if (this.type === 'predator') {
            if (this.attackCd > 0.8) {
                this.frameX = 2;
            } else {
                this.frameX = Math.floor((this.distanceTraveled || 0) / 30) % 2;
            }
        }
    }
}

export class Resource extends Entity {
    constructor(x, y, type) {
        // Hitbox radius now matches each sprite's actual visual footprint (used for mining/interaction range)
        let r = type === 'wood' ? 40 : (type === 'stone' ? 33 : (type === 'cache' ? 38 : 30));
        super(x, y, r, 3);
        this.type = type; this.hitFlashTimer = 0;
        // Solid collision radius - smaller than the interaction radius, blocks movement so you can't walk through trees/rocks
        this.solid = (type === 'wood' || type === 'stone');
        this.solidRadius = type === 'wood' ? 14 : (type === 'stone' ? 13 : 0);
    }
    update(dt) { if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt; }
}
