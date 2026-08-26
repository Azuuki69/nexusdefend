// The first piece of the simulation to actually live in its own file.
//
// The point is not tidiness: a Durable Object has no DOM, so anything it imports must load
// without one. These tests import the module the same way a server would - plain Node, no
// browser - and check that the game and the module have not drifted apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as C from '../src/sim/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(HERE, '..', 'index.html'), 'utf8');
const MOD = readFileSync(join(HERE, '..', 'src', 'sim', 'constants.js'), 'utf8');

/** Comments and string literals removed, so prose cannot be mistaken for code. */
function code(text) {
    return text
        .replace(/\r/g, '')                 // the game file is CRLF; JS `.` will not cross \r
        .replace(/\/\/.*$/gm, '')
        .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '""');
}

test('the module loads with no DOM at all', () => {
    // If this file imported successfully, Node already proved it. Assert it carries something.
    const names = Object.keys(C);
    assert.ok(names.length > 100, 'only ' + names.length + ' constants exported');
    const undef = names.filter(n => C[n] === undefined);
    assert.deepEqual(undef, [], 'exports with no value: ' + undef.join(', '));
});

test('it is pure data - nothing in it reaches for the browser or the world', () => {
    const body = code(MOD);
    for (const forbidden of ['document', 'window', 'canvas', 'new Image', 'getElementById']) {
        assert.ok(!body.includes(forbidden),
            'constants.js mentions ' + forbidden + ', so a server cannot import it');
    }
    // BUILDINGS lived here briefly and broke the buildings panel: its count() closures read
    // `world`, which does not exist in a module. Nothing may reach for runtime state.
    for (const runtime of ['world', 'player', 'players', 'inventory', 'cam']) {
        const re = new RegExp('\\b' + runtime + '\\b');
        assert.ok(!re.test(body), 'constants.js references runtime state `' + runtime + '`');
    }
});

test('the game imports every name the module exports', () => {
    // A multi-declarator const moves whole. Importing only the names the simulation happened
    // to reference left VIEW_H, WORLD_CX and 55 others undefined in the game.
    const start = SRC.indexOf('import {');
    const end = SRC.indexOf("from './src/sim/constants.js'");
    assert.ok(start !== -1 && end !== -1 && start < end, 'the constants import is missing');
    const imported = new Set(SRC.slice(start, end).match(/[A-Za-z_$][\w$]*/g) || []);
    const missing = Object.keys(C).filter(n => !imported.has(n));
    assert.deepEqual(missing, [], 'exported but never imported: ' + missing.join(', '));
});

test('the game does not redefine what it imports', () => {
    // Two definitions of one constant is how the client and the server drift apart.
    const body = code(SRC);
    const redefined = Object.keys(C).filter(n =>
        new RegExp('(?:const|let|var)\\s+' + n + '\\s*=').test(body));
    assert.deepEqual(redefined, [], 'defined in both places: ' + redefined.join(', '));
});

test('values the balance depends on are still what the game was tuned for', () => {
    // A silent edit to one of these changes how the game plays; pin the load-bearing few.
    assert.equal(C.WORLD_W, 5760);
    assert.equal(C.WORLD_H, 3240);
    assert.equal(C.WORLD_CX, C.WORLD_W / 2);
    assert.equal(C.WORLD_CY, C.WORLD_H / 2);
    assert.equal(C.NEXUS_BASE_HP, 700);
    assert.equal(C.KING_WAVE_INTERVAL, 10);
    assert.equal(C.COOP_ENEMY_STEP, 0.6);
    assert.equal(C.COOP_TOUGH_STEP, 0.5);
});

test('BUILDINGS stayed with the client, where the world is', () => {
    assert.equal(C.BUILDINGS, undefined, 'BUILDINGS is back in the module and will throw');
    assert.ok(/const BUILDINGS = \{/.test(SRC), 'BUILDINGS is not defined in index.html either');
});
