// Numbers the simulation runs on.
//
// Extracted so the same values drive the browser and a Durable Object without being duplicated
// or drifting apart. Pure data only: nothing here touches a canvas, an Image or the DOM, which
// is what lets a server import it.
//
// Client-only tables - ability icon sheets and the like - deliberately stayed in index.html.

export const VIEW_W = 1920, VIEW_H = 1080;
export const WORLD_W = 5760, WORLD_H = 3240;      // 3x3 screens = 9x the old play area
export const WORLD_CX = WORLD_W / 2, WORLD_CY = WORLD_H / 2;
export const SPAWN_RING = 1250;                   // enemies walk in from here, not the world edge
export const POND_CX = 0.515, POND_CY = 0.535, POND_RX = 0.410, POND_RY = 0.295;
export const KING_WAVE_INTERVAL = 10;      // waves 10, 20, 30 ...
export const KING_HP_MULT = 25, KING_DMG_BASE = 45, KING_SPD_MULT = 0.55;
export const KING_SLAM_RANGE = 210, KING_SLAM_CD = 4.0, KING_SLAM_DMG = 1.6;
export const HARPY_HP_MULT = 0.45, HARPY_SPD_MULT = 1.9;
export const GOB_HP_MULT = 0.35, GOB_SPD_MULT = 1.55, GOB_DMG_MULT = 0.6;
export const GOB_RANGE = 270, GOB_MELEE_RANGE = 62, GOB_SHOT_CD = 0.85;
export const CYCLOP_HP_MULT = 8, CYCLOP_DMG_BASE = 22, CYCLOP_SPD_MULT = 0.85;
export const CYCLOP_SMASH = 105, CYCLOP_SMASH_CD = 3.2;
export const CYCLOP_CHANCE = 0.30, CYCLOP_MIN_WAVE = 3, CYCLOP_GAP = 2;
export const TROLL_HP_MULT = 6, TROLL_DMG_BASE = 18, TROLL_SPD_MULT = 0.95;
export const TROLL_REGEN = 0.02;                    // fraction of max hp per second
export const TROLL_CHANCE = 0.16, TROLL_MIN_WAVE = 4, TROLL_GAP = 3;
export const RIDER_HP_MULT = 2.6, RIDER_SPD_MULT = 1.35, RIDER_DMG_BASE = 16;
export const RIDER_CHARGE_MIN = 220;      // needs this much clear ground to build a charge
export const RIDER_CHARGE_TIME = 1.6;     // seconds from a standing start to full gallop
export const RIDER_CHARGE_SPD = 1.8;      // top speed multiplier
export const RIDER_CHARGE_DMG = 2.4;      // damage multiplier at full charge
export const RIDER_CHARGE_LAND = 0.55;    // below this the blow counts as an ordinary swing
export const RIDER_WHEEL = 1.8, RIDER_KNOCKBACK = 46;
export const RIDER_CHANCE = 0.14, RIDER_MIN_WAVE = 5, RIDER_GAP = 3;
export const RIDER_PACK_MIN = 2, RIDER_PACK_MAX = 3;
export const WANDER_SPEED = 1.15;                  // slower than the player, so you can catch him
export const WANDER_PAUSE_MIN = 1.5, WANDER_PAUSE_MAX = 4.0;
export const TALK_RANGE = 130, TALK_BUBBLE_TIME = 6.5;
export const CAMP_X = WORLD_CX + 1250, CAMP_Y = WORLD_CY + 900;
export const CAMP_NPC_X = CAMP_X - 34, CAMP_NPC_Y = CAMP_Y + 58;
export const CAMP_RANGE = 130;
export const POTION_LIFE = 25.0, POTION_WARN = 6.0;
export const BOMBER_FUSE = 90;     // how close before it shows the blast frame
export const HEAL_FRACTION = 0.18; // a healer's tick, as a share of the patient's max hp
export const BOAR_FRAMES = [
        { sx: 18,  sy: 136, sw: 167, sh: 170 }, { sx: 185, sy: 136, sw: 158, sh: 170 },
        { sx: 343, sy: 119, sw: 135, sh: 188 }, { sx: 478, sy: 158, sw: 176, sh: 154 }
    ];
export const DEER_FRAMES = [
        { sx: 18,  sy: 52,  sw: 167, sh: 254 }, { sx: 185, sy: 52,  sw: 151, sh: 254 },
        { sx: 343, sy: 49,  sw: 118, sh: 258 }, { sx: 461, sy: 49,  sw: 198, sh: 263 }
    ];
export const RABBIT_FRAMES = [
        { sx: 16,  sy: 112, sw: 170, sh: 194 }, { sx: 186, sy: 112, sw: 154, sh: 194 },
        { sx: 343, sy: 94,  sw: 127, sh: 214 }, { sx: 470, sy: 180, sw: 188, sh: 132 }
    ];
export const CRITTER_WALK1 = 0, CRITTER_WALK2 = 1, CRITTER_IDLE = 2, CRITTER_EAT = 3;
export const CRITTERS = {
        boar:   { sprite: null, frames: BOAR_FRAMES,   h: 78,  feet: 22, radius: 20, hp: 90, spd: 0.9, flee: 2.6, meat: 0.80 },
        deer:   { sprite: null, frames: DEER_FRAMES,   h: 100, feet: 27, radius: 18, hp: 55, spd: 1.2, flee: 3.4, meat: 0.60 },
        rabbit: { sprite: null, frames: RABBIT_FRAMES, h: 46,  feet: 13, radius: 10, hp: 18, spd: 1.0, flee: 3.8, meat: 0.15 }
    };
export const CRITTER_FLEE_TIME = 4.0, CRITTER_PAUSE_MIN = 2.0, CRITTER_PAUSE_MAX = 6.0;
export const AGGRO_RANGE = 360, AGGRO_RANGE_GOLEM = 140, AGGRO_HOLD = 4.0, AGGRO_DROP = 1.7;
export const MAX_EXTRACTORS = 3;
export const EXTRACTOR_COST = 50;
export const TP_PER_LEVEL = 2, TALENT_XP_GROWTH = 1.5, TIER_STEP = 2, PARAGON_UNLOCK = 8;
export const FREEZE_DURATION = 1.5, FREEZE_IMMUNITY = 5.0;
export const BEAR_LOOT_BASE = 25, BEAR_LOOT_PER_WAVE = 8;
export const NEXUS_BASE_HP = 700, NEXUS_HP_GROWTH = 1.09, FORGE_MAX_LEVEL = 5;
export const COOP_ENEMY_STEP = 0.6;      // extra trash per additional player
export const COOP_TOUGH_STEP = 0.5;      // extra boss and Nexus health per additional player
export const MINING_YIELD_STEP = 0.3;      // five levels = 2.5x total, not 6x
export const NEXUS_KEEPOUT = 155;   // nothing may be built inside the structure

export const CACHES_PER_MAP = 3;
export const MERCHANT_FRAMES = [15, 95, 174, 254, 333, 413];
export const HERO_WALK = {
        // swing.png's WALK LOOP: a true right-facing profile, one orientation across all four
        // frames, feet on a single ground line (every crop bottoms out at y=127).
        warrior: { faces: 'right', h: 98, feet: 40, frames: [
            [387,56,39,71,0], [466,55,41,72,0], [541,55,41,72,0], [614,55,51,72,0] ] },
        mage:    { faces: 'right', h: 98, feet: 40, frames: [
            [351,41,47,89,0], [424,37,58,92,1], [515,38,39,91,1], [590,41,51,89,0] ] },
        archer:  { faces: 'right', h: 98, feet: 40, frames: [
            [60,194,81,124,0], [227,193,70,123,2], [398,193,61,125,0], [559,193,86,123,2] ] },
        // The right-facing row's own frame 1 is unusable - the neighbouring attack pose's beam is
        // painted as an opaque wash across the whole upper half of that cell, in the same cream as
        // the priest's hair, so it can be neither cropped nor keyed out. Borrowing the left row's
        // frame 1 and mirroring it was worse: that pose is drawn front-on, so it spun.
        // The remaining three frames are passing / mid / contact, so they run as a ping-pong -
        // passing, mid, contact, mid - which is an even four-beat walk off three drawings.
        priest:  { faces: 'right', h: 98, feet: 40, frames: [
            [460,62,35,89,0], [535,65,38,86,0], [604,66,46,85,0], [535,65,38,86,0] ] }
    };
export const ATTACK_ANIM_TIME = 0.25;
export const BODY_OFFSET_X = { priest: [7, 0, 0] };
export const PREDATOR_BASE_HP = 1000, PREDATOR_HP_GROWTH = 1.15;
export const BEAR_SPAWN_CHANCE = 0.22, BEAR_MIN_GAP_DAYS = 2;
export const RAIN_RADIUS = 165, RAIN_DURATION = 3.0, RAIN_TICK_DMG = 0.55, RAIN_SPLINTERS = 5;
export const ACTOR_CLEAR = 110, CRITTER_CLEAR = 70, NPC_CLEAR = 80;

// Sizes and reaches the simulation needs. They share their lines with drawing
// dimensions, so the statements move whole and the renderer imports them back.
export const ORC_DRAW_H = 92, ORC_FEET = 26, ORC_MELEE_RANGE = 70;
export const KING_DRAW_H = 260, KING_FEET = 70, KING_RADIUS = 80;
export const GOB_DRAW_H = 104, GOB_FEET = 30, GOB_RADIUS = 19;
export const CYCLOP_DRAW_H = 168, CYCLOP_FEET = 46, CYCLOP_RADIUS = 34;
export const TROLL_DRAW_H = 142, TROLL_FEET = 40, TROLL_RADIUS = 27;
export const RIDER_DRAW_H = 118, RIDER_FEET = 33, RIDER_RADIUS = 22;
export const EXTRACTOR_H = 118, EXTRACTOR_FEET = 40, EXTRACTOR_SPACING = 130, EXTRACTOR_HP = 200;
export const NEXUS_IMG = 285, NEXUS_RADIUS = 85;
