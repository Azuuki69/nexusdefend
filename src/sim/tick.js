// The tick.
//
// stepWorld advances a match by one fixed step: the phase clock, the waves, the weather, every
// entity, and the end of the run. It is the function a Durable Object will call twenty times a
// second, and it needs no screen to do it.
//
// handleLocalIntents deliberately stayed in index.html. That half is the camera, the pause and
// which of this client's windows to open - none of which a server has or wants.

import { WORLD_W, WORLD_H, WORLD_CX, WORLD_CY, KING_WAVE_INTERVAL, CYCLOP_CHANCE,
    CYCLOP_MIN_WAVE, CYCLOP_GAP, TROLL_CHANCE, TROLL_MIN_WAVE, TROLL_GAP, RIDER_CHANCE,
    RIDER_MIN_WAVE, RIDER_GAP, RIDER_PACK_MIN, RIDER_PACK_MAX, CAMP_X, CAMP_Y, CRITTERS,
    FORGE_MAX_LEVEL, MINING_YIELD_STEP, CACHES_PER_MAP, BEAR_SPAWN_CHANCE, BEAR_MIN_GAP_DAYS,
    ACTOR_CLEAR, CRITTER_CLEAR, NPC_CLEAR, TENT_SOLID, CRITTER_POP, CRITTER_KEEPOUT,
    FORGE_RANGE, EARLY_NIGHT_MANA_PER_SEC
} from './constants.js';
import { rnd, livingPlayers, killCredit, coopEnemyMult, grantShopBuff, isCollidingWithObstacle,
    playSound, spawnParticles, addShake, world, clampWorld, ui
} from './world.js';
import { ringSpawn, resourceCountFor, merchantVisits, checkAchievement, Obstacle, Merchant,
    Wanderer, Critter, FloatingText, Enemy, Resource
} from './entities.js';

// Scenery: pure decoration, never gatherable. Crops measured off the two sheets,
// grouped by size so the scatter can lean heavily on small stuff and stay sparse
// with the landmark trees. [sx, sy, sw, sh]
export const SCENERY = [
    // --- tufts and pebbles (very common, tiny) ---
    { sheet:'trees', w:9, h:15, boxes:[[33,28,22,20],[76,26,23,22],[121,20,27,30],[172,28,23,22],[230,25,26,26],[295,33,24,18],[386,30,22,18],[446,25,36,26],[529,26,37,24],[604,26,40,25]] },
    { sheet:'rocks', w:8, h:12, solid:0, boxes:[[31,31,44,34],[103,22,57,51],[185,22,55,51]] },
    // --- bushes and small rocks (common, medium) ---
    { sheet:'trees', w:5, h:38, boxes:[[33,63,38,49],[96,60,42,52],[156,74,49,38],[221,73,45,39],[282,69,51,43],[351,68,60,44],[424,73,74,38],[509,73,77,38],[597,77,62,35]] },
    { sheet:'rocks', w:5, h:24, solid:0, boxes:[[276,29,44,36],[351,26,56,41],[433,22,61,49],[518,19,54,54],[596,18,56,56],[22,107,60,48],[103,105,57,52],[181,107,65,48],[267,104,61,54],[350,101,60,59],[431,99,63,62],[517,104,56,53],[595,104,57,54]] },
    // --- small trees and boulders (uncommon, large) ---
    { sheet:'trees', w:3, h:144, solid:0.15, canopy:true, boxes:[[31,138,47,65],[91,134,46,69],[158,140,45,63],[221,138,46,65],[279,125,56,80],[350,122,62,83],[425,122,72,84],[510,119,70,87],[589,119,68,90]] },
    { sheet:'rocks', w:2, h:42, solid:0.36, boxes:[[19,188,93,77],[131,187,86,78],[237,188,92,77],[347,190,93,72],[485,205,78,46],[582,194,75,64],[22,294,88,51],[133,287,76,63],[236,293,89,54],[347,287,91,63],[482,291,83,56],[599,287,62,65]] },
    // --- landmark trees (rare, big) ---
    { sheet:'trees', w:1, h:168, solid:0.12, canopy:true, boxes:[[21,212,209,145],[241,220,95,132],[352,231,144,124],[516,214,139,143]] }
];

// Derived from SCENERY, so it lives where SCENERY lives - constants.js has no access to it.
export const SCENERY_WEIGHT_TOTAL = SCENERY.reduce((a, g) => a + g.w, 0);

export function rollScenery() {
    let r = rnd() * SCENERY_WEIGHT_TOTAL;
    for (const g of SCENERY) { r -= g.w; if (r <= 0) return g; }
    return SCENERY[0];
}

// The forge is no longer scenery the map hands you: it is raised from gathered wood and
// stone like anything else, so until it is built there is nowhere to upgrade at.
export function forgeX() { return world.forgeBuilding ? world.forgeBuilding.x : 0; }

export function forgeY() { return world.forgeBuilding ? world.forgeBuilding.y : 0; }

export function playerAtForge(p) {
    // Asks about one player: in co-op the answer is different for each of them.
    p = p || world.players[0];
    return !!p && world.forgeBuilding && world.gameState === 'DAY'
        && Math.hypot(p.x - world.forgeBuilding.x, p.y - world.forgeBuilding.y) < FORGE_RANGE;
}

export function startNightEarly() { 
    if(world.gameState === 'DAY') {
        let bonusMana = Math.floor(world.phaseTimer * EARLY_NIGHT_MANA_PER_SEC);
        world.inventory.mana += bonusMana;
        const claimant = killCredit();
        if (claimant) world.entities.texts.push(new FloatingText(claimant.x, claimant.y - 40, `+${bonusMana} MANA (SPEED BONUS)`, '#00ffff'));
        playSound('pickup');
        world.phaseTimer = 0; 
    } 
}

// Keeps the wilds stocked without letting the population creep up day after day.
export function stockWildlife() {
    for (let type in CRITTER_POP) {
        let have = world.entities.critters.filter(c => c.type === type).length;
        for (let i = have; i < CRITTER_POP[type]; i++) {
            for (let t = 0; t < 40; t++) {
                let x = 200 + rnd() * (WORLD_W - 400);
                let y = 200 + rnd() * (WORLD_H - 400);
                if (Math.hypot(x - WORLD_CX, y - WORLD_CY) < CRITTER_KEEPOUT) continue;
                if (isCollidingWithObstacle(x, y, CRITTERS[type].radius)) continue;
                world.entities.critters.push(new Critter(type, x, y));
                break;
            }
        }
    }
}

// The scatter knew about the nexus and the forge but not about anyone standing on the
// map, and generateMap runs at every dawn - so a morning could drop a trunk on whoever
// was out gathering. Measured at 5.5% of dawns, plus 0.8% of fresh games burying the
// fixed spawn point. Being buried is unrecoverable: every direction is blocked, so you
// cannot walk out of it.
export function protectedSpots() {
    let pts = [];
    // Every player's spot is protected, not just the one this client happens to be.
    for (const p of world.players) pts.push({ x: p.x, y: p.y, r: ACTOR_CLEAR });
    world.entities.critters.forEach(c => pts.push({ x: c.x, y: c.y, r: CRITTER_CLEAR }));
    world.entities.npcs.forEach(np => pts.push({ x: np.x, y: np.y, r: NPC_CLEAR }));
    return pts;
}

export function tooCloseToActor(pts, x, y) {
    for (let p of pts) if (Math.hypot(p.x - x, p.y - y) < p.r) return true;
    return false;
}

// Belt and braces for whatever the clearance still misses. The player gets the offending
// prop deleted rather than being teleported; everything else is cheap to move.
export function freeBuriedActors() {
    for (const player of world.players) {
        for (let guard = 0; guard < 8; guard++) {
            if (!isCollidingWithObstacle(player.x, player.y, player.radius)) break;
            let before = world.entities.solids.length + world.entities.resources.length;
            world.entities.solids = world.entities.solids.filter(sp => Math.hypot(sp.x - player.x, sp.y - player.y) >= sp.r + player.radius);
            world.entities.resources = world.entities.resources.filter(r => !r.solid || Math.hypot(r.x - player.x, r.y - player.y) >= r.solidRadius + player.radius);
            if (world.entities.solids.length + world.entities.resources.length === before) {
                // Nothing left to delete, so it is terrain - step out of it instead.
                let ang = Math.atan2(player.y - WORLD_CY, player.x - WORLD_CX);
                for (let step = 1; step <= 24; step++) {
                    let nx = clampWorld(player.x + Math.cos(ang) * step * 40, WORLD_W, 60);
                    let ny = clampWorld(player.y + Math.sin(ang) * step * 40, WORLD_H, 60);
                    if (!isCollidingWithObstacle(nx, ny, player.radius)) { player.x = nx; player.y = ny; break; }
                }
                break;
            }
        }
    }
    world.entities.critters.concat(world.entities.npcs).forEach(a => {
        if (!isCollidingWithObstacle(a.x, a.y, a.radius)) return;
        for (let t = 0; t < 30; t++) {
            let ang = rnd() * Math.PI * 2, d = 90 + rnd() * 260;
            let nx = clampWorld(a.x + Math.cos(ang) * d, WORLD_W, 100);
            let ny = clampWorld(a.y + Math.sin(ang) * d, WORLD_H, 100);
            if (!isCollidingWithObstacle(nx, ny, a.radius)) { a.x = nx; a.y = ny; return; }
        }
    });
}

export function generateMap() {
    world.entities.obstacles = []; world.entities.resources = []; world.entities.decorations = []; world.entities.solids = [];
    let actorSpots = protectedSpots();

    // A few ponds, well clear of the nexus. Kept square so the sprite is never
    // stretched out of shape - the pond's own art supplies the oval.
    const lakes = [ [-2150, -900, 760], [1650, -1150, 620], [-1250, 1000, 680] ];
    lakes.forEach(l => world.entities.obstacles.push(new Obstacle(WORLD_CX + l[0], WORLD_CY + l[1], l[2], l[2], 'lake')));

    layOutCamp();

    // Ground detail, scaled to the area. Placed after the ponds so nothing is
    // scattered across open water.
    for(let i=0; i<260; i++) {
        let dx = rnd() * WORLD_W, dy = rnd() * WORLD_H;
        if (isCollidingWithObstacle(dx, dy, 0)) continue;
        world.entities.decorations.push({ x: dx, y: dy, type: rnd() > 0.5 ? 'grass' : 'pebble', size: rnd() * 3 + 2 });
    }



    for(let i=0, want=resourceCountFor(world.wave); i<want; i++) {
        // Retry placement so resources never overlap each other, obstacles, or the base
        let placed = false;
        for (let attempt = 0; attempt < 20 && !placed; attempt++) {
            let x = rnd() * (WORLD_W - 120) + 60; let y = rnd() * (WORLD_H - 120) + 60;
            if (Math.hypot(x-WORLD_CX, y-WORLD_CY) < 260) continue;
            if (Math.hypot(x-CAMP_X, y-CAMP_Y) < 220) continue;
            if (tooCloseToActor(actorSpots, x, y)) continue;
            if (isCollidingWithObstacle(x, y, 45)) continue;
            let overlapsResource = world.entities.resources.some(r => Math.hypot(r.x - x, r.y - y) < 135);
            if (overlapsResource) continue;
            world.entities.resources.push(new Resource(x, y, rnd() > 0.5 ? 'wood' : 'stone'));
            placed = true;
        }
    }

    // Spawn Mystery Caches - deliberately rare, they are a bonus not a staple
    for(let i=0; i<CACHES_PER_MAP; i++) {
        let cx = rnd() * (WORLD_W - 200) + 100; let cy = rnd() * (WORLD_H - 200) + 100;
        let overlapsResource = world.entities.resources.some(r => Math.hypot(r.x - cx, r.y - cy) < 90);
        if (tooCloseToActor(actorSpots, cx, cy)) continue;
        if (Math.hypot(cx-WORLD_CX, cy-WORLD_CY) > 400 && !isCollidingWithObstacle(cx, cy, 30) && !overlapsResource) {
            world.entities.resources.push(new Resource(cx, cy, 'cache'));
        }
    }

    // Non-gatherable trees and rocks, so the world looks wooded without every
    // trunk being a resource node.
    for(let i=0; i<420; i++) {
        let dx = rnd() * WORLD_W, dy = rnd() * WORLD_H;
        if (isCollidingWithObstacle(dx, dy, 20)) continue;
        if (Math.hypot(dx - WORLD_CX, dy - WORLD_CY) < 230) continue;
        if (Math.hypot(dx - CAMP_X, dy - CAMP_Y) < 220) continue;
        if (tooCloseToActor(actorSpots, dx, dy)) continue;
        let g = rollScenery();
        let b = g.boxes[Math.floor(rnd() * g.boxes.length)];
        let dh = g.h * (0.82 + rnd() * 0.36);
        let dwid = dh * (b[2] / b[3]);
        // Clearance scales with the canopy so a big tree never sits on top of a node.
        let clear = Math.max(90, dwid * 0.6);
        if (world.entities.resources.some(r => Math.hypot(r.x - dx, r.y - dy) < clear)) continue;
        world.entities.decorations.push({ x: dx, y: dy, type: 'scenery', sheet: g.sheet,
            sx: b[0], sy: b[1], sw: b[2], sh: b[3], h: dh,
            flip: rnd() < 0.5, canopy: !!g.canopy });
        if (g.solid) world.entities.solids.push({ x: dx, y: dy, r: dwid * g.solid });
    }
    freeBuriedActors();

    // Draw back-to-front so nearer scenery overlaps what is behind it.
    world.entities.decorations.sort((a, b) => a.y - b.y);
    
    // Sleeping bear: an occasional visitor, never on consecutive days
    if (world.wave - world.lastBearWave >= BEAR_MIN_GAP_DAYS && rnd() < BEAR_SPAWN_CHANCE) {
        let ba = rnd() * Math.PI * 2, bd = 700 + rnd() * 1500;
        let px = clampWorld(WORLD_CX + Math.cos(ba) * bd, WORLD_W, 80);
        let py = clampWorld(WORLD_CY + Math.sin(ba) * bd, WORLD_H, 80);
        if (!isCollidingWithObstacle(px, py, 50)) {
            world.entities.enemies.push(new Enemy(px, py, 'predator'));
            world.entities.decorations.push({ x: px, y: py, type: 'crystal', size: 40 });
            world.lastBearWave = world.wave;
        }
    }
}

export function setWeather() {
    let rand = rnd();
    if (world.gameState === 'NIGHT') {
        if (rand < 0.1) world.currentWeather = 'bloodmoon';
        else if (rand < 0.2) world.currentWeather = 'fog';
        else if (rand < 0.3) world.currentWeather = 'blizzard';
        else world.currentWeather = 'clear';
        
        let modRand = rnd();
        if (modRand < 0.2) world.currentModifier = 'swarm';
        else if (modRand < 0.4) world.currentModifier = 'armored';
        else world.currentModifier = 'none';
    } else {
        if (rand < 0.15) world.currentWeather = 'blizzard';
        else world.currentWeather = 'clear';
        world.currentModifier = 'none';
    }
    
    let __wtext = '', __wcol = '#fff';
    let txt = ""; let col = "#fff";
    if (world.currentWeather === 'bloodmoon') { txt += "BLOOD MOON "; col = "#ff3333"; }
    else if (world.currentWeather === 'blizzard') { txt += "BLIZZARD "; col = "#aaddff"; }
    else if (world.currentWeather === 'fog') { txt += "DENSE FOG "; col = "#aaaaaa"; }

    if (world.currentModifier === 'swarm') { txt += (txt ? " | " : "") + "SWARM"; }
    else if (world.currentModifier === 'armored') { txt += (txt ? " | " : "") + "ARMORED HORDE"; }
    
    __wtext = txt;
    __wcol = col === '#fff' && txt.includes('SWARM') ? '#ffcc00' : col;
    ui.weather(__wtext, __wcol);
}

// Neither of these keeps a schedule: a roll each night, never two nights running, and
// never on a boss night - a King plus a cyclops on the same wave is not a fight, it is
// a pile-on, and boss nights read better when the boss is the story.
export function rollNightVisitor(type, chance, minWave, gap, label, count) {
    if (world.wave < minWave || world.wave % 5 === 0 || world.wave - world.lastVisitorWave[type] < gap || rnd() >= chance) return;
    world.lastVisitorWave[type] = world.wave;
    // A warband rides in together, not merely from the same compass point: picking a
    // fresh ringSpawn each time scatters them a screen apart, which reads as three
    // strays rather than a charge. Form the rest up around the leader instead.
    let side = Math.floor(rnd() * 4);
    let first = ringSpawn(side);
    world.entities.enemies.push(new Enemy(first.x, first.y, type));
    for (let i = 1; i < (count || 1); i++) {
        let px = first.x, py = first.y, placed = false;
        for (let tryN = 0; tryN < 12 && !placed; tryN++) {
            let a = rnd() * Math.PI * 2, d = 55 + rnd() * 75;
            let cx = clampWorld(first.x + Math.cos(a) * d, WORLD_W, 60);
            let cy = clampWorld(first.y + Math.sin(a) * d, WORLD_H, 60);
            if (!isCollidingWithObstacle(cx, cy, 30)) { px = cx; py = cy; placed = true; }
        }
        if (!placed) { let alt = ringSpawn(side); px = alt.x; py = alt.y; }
        world.entities.enemies.push(new Enemy(px, py, type));
    }
    world.entities.texts.push(new FloatingText(first.x, first.y - 110, label, '#ffb347'));
    playSound('explosion'); addShake(12);
}

export function spawnWave() {
    if (world.wave % 5 === 0) {
        let bpos = ringSpawn(world.waveDirection === -1 ? Math.floor(rnd()*4) : world.waveDirection);
        // Every tenth wave the Orc King turns up instead of the usual boss.
        let bossType = (world.wave % KING_WAVE_INTERVAL === 0) ? 'orcking' : 'boss';
        world.entities.enemies.push(new Enemy(bpos.x, bpos.y, bossType));
        if (bossType === 'orcking') {
            world.entities.texts.push(new FloatingText(bpos.x, bpos.y - 120, "THE ORC KING COMES", '#ff3b3b'));
            playSound('explosion'); addShake(30);
        } else addShake(15);
    }
    // Was wave*3+5, tuned when eight-plus towers were thinning the column before it ever
    // reached you. Wave one is unchanged at 8; the cut only bites later, where the missing
    // tower damage compounds worst - 26 at wave ten instead of 35.
    let count = Math.round((world.wave * 2 + 6) * coopEnemyMult());
    if (world.currentWeather === 'bloodmoon') count = Math.floor(count * 1.5);
    if (world.currentModifier === 'swarm') count *= 2;
    
    for(let i=0; i<count; i++) {
        let side = world.waveDirection !== -1 ? world.waveDirection : Math.floor(rnd() * 4);
        let pos = ringSpawn(side); let x = pos.x, y = pos.y;
        let rand = rnd(); let type = 'goblin';
        
        // Scaled wave spawning including new enemies
        if (world.wave > 0 && rand > 0.35) type = 'wolf';
        if (world.wave > 1 && rand > 0.5) type = 'orcarcher';
        if (world.wave > 2 && rand > 0.64) type = 'goblinarcher';
        if (world.wave > 2 && rand > 0.74) type = 'harpy';
        if (world.wave > 3 && rand > 0.82) type = 'bomber'; 
        if (world.wave > 4 && rand > 0.88) type = 'golem';
        if (world.wave > 5 && rand > 0.93) type = 'assassin';
        if (world.wave > 6 && rand > 0.97) type = 'necromancer';
        
        let en = new Enemy(x, y, type);
        if (world.currentModifier === 'swarm' && type !== 'boss' && type !== 'predator') {
            // Marked as well as nerfed: a body that dies to one hit should not pay like a
            // body that fought back. See the payout in Entity.takeDamage.
            en.hp = 1; en.maxHp = 1; en.swarmling = true;
        }
        world.entities.enemies.push(en);
    }
    rollNightVisitor('cyclop', CYCLOP_CHANCE, CYCLOP_MIN_WAVE, CYCLOP_GAP, "A CYCLOPS STIRS", 1);
    rollNightVisitor('troll', TROLL_CHANCE, TROLL_MIN_WAVE, TROLL_GAP, "A TROLL PROWLS", 1);
    rollNightVisitor('orcrider', RIDER_CHANCE, RIDER_MIN_WAVE, RIDER_GAP, "WARG RIDERS!",
                     RIDER_PACK_MIN + Math.floor(rnd() * (RIDER_PACK_MAX - RIDER_PACK_MIN + 1)));

    world.waveDirection = -1; // Reset for next day
}

export function triggerGameOver() { world.gameState = 'OVER'; ui.gameOver(); }

// The tick. Everything here is the match rather than the view of it.
export function stepWorld(dt) {
    world.phaseTimer -= dt;
    
    // Threat Indicator Logic
    if (world.gameState === 'DAY' && world.phaseTimer <= 3.0 && world.waveDirection === -1) {
        world.waveDirection = Math.floor(rnd() * 4);
    }

    if (world.gameState === 'NIGHT' && world.entities.enemies.length === 0) world.phaseTimer = 0;

    if (world.phaseTimer <= 0) {
        if (world.gameState === 'DAY') {
            world.gameState = 'NIGHT'; world.phaseTimer = 90; setWeather();
            ui.phase(world.wave % 5 === 0 ? "BOSS WAVE - DEFEND!" : "NIGHT PHASE - DEFEND!", '#ff4d4d');
            ui.nightButton(false);
            
            // Clear day buffs
            world.players.forEach(p => { if (p.hasDaySpeed) { p.buffs.speedMult -= 1.0; p.hasDaySpeed = false; } });

            // The bear only prowls by day - it retreats to the forest at nightfall.
            world.entities.npcs.forEach(npc => {
                if (npc.isShop) return;
                world.entities.texts.push(new FloatingText(npc.x, npc.y - 60, "MAKES CAMP", '#e8d8a8'));
                spawnParticles(npc.x, npc.y, '#e8d8a8', 10);
                npc.markedForDeletion = true;
            });
            world.entities.enemies.forEach(e => {
                if (e.type === 'predator') {
                    spawnParticles(e.x, e.y, '#8a6a4a', 12);
                    world.entities.texts.push(new FloatingText(e.x, e.y - 40, "RETREATS", '#c8a06a'));
                    e.markedForDeletion = true;
                }
            });
            
            ui.closeAll(); world.players.forEach(p => p.placing = null); ui.buildPalette(); spawnWave();
        } else {
            world.gameState = 'DAY'; world.wave++; world.phaseTimer = 60; setWeather();
            ui.phase(merchantVisits(world.wave) ? "DAY PHASE - MERCHANT IN TOWN" : "DAY PHASE - GATHER", '#fff');
            ui.nightButton(true);
            ui.waveNumber(world.wave); world.base.recalcMaxHp(); world.base.repairedToday = false; generateMap(); ui.buildPalette();
            if (merchantVisits(world.wave)) world.entities.npcs.push(new Merchant());
            world.entities.npcs.push(new Wanderer());
            stockWildlife();
        }
    }

    // Each player acts on their own intent. With one player this loop runs once and
        // does exactly what the single global `player` used to do.
        for (const actor of world.players) {
        const intent = actor.intent;
        if (intent.attack) {
        let clickedInteractable = false;
        if (world.gameState === 'DAY') {
            world.entities.npcs.forEach(npc => { if (Math.hypot(intent.aimX - npc.x, intent.aimY - npc.y) < 40 && Math.hypot(actor.x - npc.x, actor.y - npc.y) < 150) { if (npc.isShop) ui.open('merchant'); else npc.talk(); clickedInteractable = true; } });
            if (!clickedInteractable && playerAtForge() && Math.hypot(intent.aimX - forgeX(), intent.aimY - forgeY()) < 90) { ui.open('forge'); clickedInteractable = true; }
        }
        if (!clickedInteractable) {
            world.entities.resources.forEach(r => {
                // Hit radius now matches each resource's real sprite size (r.radius), not a guessed constant
                if (Math.hypot(intent.aimX - r.x, intent.aimY - r.y) < r.radius && Math.hypot(actor.x - r.x, actor.y - r.y) < r.radius + 130) {
                    
                    if (r.type === 'cache') {
                        r.markedForDeletion = true; clickedInteractable = true; playSound('pickup'); spawnParticles(r.x, r.y, '#ffcc00', 20);
                        let rand = rnd();
                        if (rand < 0.33) {
                            world.inventory.mana += 50; world.entities.texts.push(new FloatingText(r.x, r.y - 20, "+50 MANA", '#00ffff'));
                        } else if (rand < 0.66) {
                            world.players.forEach(p => { if (!p.hasDaySpeed) { p.hasDaySpeed = true; p.buffs.speedMult += 1.0; } });
                            world.entities.texts.push(new FloatingText(r.x, r.y - 20, "SPEED BUFF", '#00ffcc'));
                        } else {
                            // The forge caps at FORGE_MAX_LEVEL and a cache has no business
                            // walking past it - unfiltered, this printed 6/5 on the pips.
                            let upgs = ['weapon', 'mining', 'speed'].filter(u => world.forgeUpgrades[u].level < FORGE_MAX_LEVEL);
                            if (!upgs.length) {
                                world.inventory.mana += 50; world.entities.texts.push(new FloatingText(r.x, r.y - 20, "+50 MANA", '#00ffff'));
                            } else {
                                let chosen = upgs[Math.floor(rnd()*upgs.length)];
                                world.forgeUpgrades[chosen].level++;
                                if (chosen === 'weapon') { grantShopBuff(actor, 'forgeAtkMult', 0.1); actor.recalcStats(); }
                                if (chosen === 'mining') { grantShopBuff(actor, 'gatherYield', MINING_YIELD_STEP); }
                                if (chosen === 'speed') { grantShopBuff(actor, 'speedMult', 0.05); }
                                world.entities.texts.push(new FloatingText(r.x, r.y - 20, "FORGE UPGRADE", '#ffcc00')); ui.forgePanel();
                            }
                        }
                    } else {
                        r.hp--; clickedInteractable = true; r.hitFlashTimer = 0.1; playSound('mine');
                        world.entities.texts.push(new FloatingText(r.x, r.y - 20, "⛏️", '#ffffff'));
                        spawnParticles(r.x, r.y, r.type === 'wood' ? '#8B4513' : '#777', 3);
                        
                        if(r.hp <= 0) {
                            r.markedForDeletion = true;
                            // gatherYield is fractional now, so round here or the counters
                            // start showing half a log.
                            let amt = Math.round(5 * actor.buffs.gatherYield);
                            if(r.type === 'wood') { world.inventory.wood += amt; world.gameStats.wood += amt; if (world.gameStats.wood >= 50) checkAchievement('lumberjack'); } 
                            else { world.inventory.stone += amt; world.gameStats.stone += amt; if (world.gameStats.stone >= 50) checkAchievement('mason'); }
                        }
                    }
                }
            });
        }
        // A click used on something interactable is spent: it must not also swing, and
        // must stay spent until the button comes back up.
        if (clickedInteractable) { intent.attackSpent = true; intent.attack = false; }
        else actor.attack(); 
    }
    }

    world.players.forEach(p => p.update(dt));
    world.base.update(dt);
    world.entities.npcs.forEach(n => n.update(dt)); world.entities.critters.forEach(c => c.update(dt)); world.entities.resources.forEach(r => r.update(dt)); world.entities.extractors.forEach(t => t.update(dt));
    world.entities.enemies.forEach(e => e.update(dt)); world.entities.projectiles.forEach(p => p.update(dt)); world.entities.effects.forEach(ef => ef.update(dt));
    world.entities.texts.forEach(txt => txt.update(dt)); world.entities.particles.forEach(p => p.update(dt)); world.entities.items.forEach(i => i.update(dt));


    let extractorsBefore = world.entities.extractors.length;
    world.entities.npcs = world.entities.npcs.filter(n => !n.markedForDeletion); world.entities.critters = world.entities.critters.filter(c => !c.markedForDeletion); world.entities.extractors = world.entities.extractors.filter(t => !t.markedForDeletion);
    if (world.entities.extractors.length !== extractorsBefore) ui.buildPalette();   // a destroyed extractor frees its slot
    world.entities.enemies = world.entities.enemies.filter(e => !e.markedForDeletion); world.entities.projectiles = world.entities.projectiles.filter(p => !p.markedForDeletion);
    world.entities.resources = world.entities.resources.filter(r => !r.markedForDeletion); world.entities.effects = world.entities.effects.filter(ef => !ef.markedForDeletion);
    world.entities.texts = world.entities.texts.filter(txt => !txt.markedForDeletion); world.entities.particles = world.entities.particles.filter(p => !p.markedForDeletion);
    world.entities.items = world.entities.items.filter(i => !i.markedForDeletion);

    if (livingPlayers().length === 0 || world.base.hp <= 0) { triggerGameOver(); }

    ui.hud();
}

// The camp is a landmark, so it goes back in the same place every morning.
export function layOutCamp() {
    world.entities.decorations.push({ x: CAMP_X, y: CAMP_Y, type: 'camp' });
    world.entities.decorations.push({ x: CAMP_X - 34, y: CAMP_Y + 58, type: 'sentry', flip: false });
    world.entities.solids.push({ x: CAMP_X, y: CAMP_Y, r: TENT_SOLID });
    world.entities.solids.push({ x: CAMP_X - 34, y: CAMP_Y + 58, r: 14 });
}
