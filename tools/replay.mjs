// Replay a match from its seed and its input log.
//
//   node tools/replay.mjs <match-id> [server]
//   node tools/replay.mjs --file some-replay.json
//
// This is only possible because Phase 1 made the simulation deterministic: the seed decides the
// world and the inputs decide everything the players did, so those two things ARE the recording.
// There are no positions in a replay file. A 3-second match is about a kilobyte.
//
// It is also the sharpest determinism test there is. If the server and this run disagree about
// the wave, the simulation has drifted somewhere between them - which is exactly the failure the
// whole server-authoritative design exists to make impossible.

import { readFile } from 'node:fs/promises';
import { createWorld, useWorld, world, makeIntent, seedRun, setFxMode, drainFx } from '../src/sim/world.js';
import { stepWorld, generateMap, stockWildlife } from '../src/sim/tick.js';
import { Base, Player, Merchant, Wanderer, merchantVisits } from '../src/sim/entities.js';

const args = process.argv.slice(2);

let data;
if (args[0] === '--file') {
    data = JSON.parse(await readFile(args[1], 'utf8'));
} else {
    const id = args[0];
    const server = args[1] || 'http://127.0.0.1:8787';
    if (!id) {
        console.error('usage: node tools/replay.mjs <match-id> [server]');
        process.exit(2);
    }
    const res = await fetch(`${server}/api/replay/${encodeURIComponent(id)}`);
    if (!res.ok) {
        console.error(`no replay for ${id} (${res.status})`);
        process.exit(1);
    }
    data = await res.json();
}

const hz = data.hz || 20;
const dt = 1 / hz;

// Build the same world the server built. The ORDER matters as much as the seed: every call
// below draws from the same seeded stream, so doing them in a different sequence produces a
// different map from the same number. This mirrors MatchRoom.initWorld line for line.
useWorld(createWorld());
seedRun(data.seed);
world.base = new Base();
world.gameState = 'DAY';
generateMap();
if (merchantVisits(world.wave)) world.entities.npcs.push(new Merchant());
world.entities.npcs.push(new Wanderer());
stockWildlife();
setFxMode('record');
drainFx();

const bySlot = new Map();
for (const { id, slot, cls } of data.players || []) {
    const p = new Player(cls || 'warrior');
    p.netId = id;
    p.intent = makeIntent();
    world.players.push(p);
    bySlot.set(slot, p);
}
if (world.players.length) world.base.recalcMaxHp();

// The log holds only the ticks where somebody changed what they were doing. Between two
// entries a player keeps doing the same thing, which is what makes the file small.
const inputs = data.inputs || [];
let cursor = 0;

for (let tick = 0; tick <= data.ticks; tick++) {
    while (cursor < inputs.length && inputs[cursor][0] <= tick) {
        const [, slot, moveX, moveY, aimX, aimY, bits] = inputs[cursor++];
        const p = bySlot.get(slot);
        if (p) {
            p.intent.moveX = moveX;
            p.intent.moveY = moveY;
            p.intent.aimX = aimX;
            p.intent.aimY = aimY;
            p.intent.attack = !!(bits & 1);
            p.intent.dash = !!(bits & 2);
            p.intent.place = !!(bits & 4);
            // The simulation clears these itself once it has acted on them, exactly as it does
            // on the server, so setting them here is the whole of "the player pressed E".
            p.intent.ability = !!(bits & 8);
            p.intent.overcharge = !!(bits & 16);
            p.intent.interact = !!(bits & 32);
        }
    }
    stepWorld(dt);
}

console.log(`match   ${data.matchId}`);
console.log(`seed    ${data.seed}`);
console.log(`log     ${inputs.length} input changes over ${data.ticks} ticks ` +
            `(${(data.ticks / hz).toFixed(1)}s at ${hz}Hz)`);
console.log(`party   ${world.players.length}`);
console.log('--- replayed ---');
console.log(`wave    ${world.wave}`);
console.log(`phase   ${world.gameState}`);
console.log(`nexus   ${Math.round(world.base.hp)}/${Math.round(world.base.maxHp)}`);
console.log(`enemies ${world.entities.enemies.length}`);
console.log(`kills   ${world.gameStats.kills}`);
