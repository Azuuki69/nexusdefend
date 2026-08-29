// A dropped connection is not a defeat.
//
// This is the rule Phase 4's sixty-second rejoin grace depends on, and it was wrong until a
// Phase 5 end-to-end run caught it: the moment the last player's socket closed, the party looked
// wiped and the match declared game over. The grace period was real and completely pointless.
//
// The simulation must not know what a socket is, so the seam is a single number the server sets.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, useWorld, world, seedRun, livingPlayers } from '../src/sim/world.js';
import { stepWorld, generateMap } from '../src/sim/tick.js';
import { Base, Player } from '../src/sim/entities.js';

function match(seed = 4242) {
    useWorld(createWorld());
    seedRun(seed);
    world.base = new Base();
    world.gameState = 'DAY';
    generateMap();
    return world;
}

describe('a party that is gone versus a party that is dead', () => {
    beforeEach(() => { match(); });

    test('a fresh world holds nobody back from returning', () => {
        assert.equal(world.pendingReturn, 0,
            'single-player must be untouched by this - it never sets pendingReturn');
    });

    test('an empty party with nobody expected back is a loss', () => {
        assert.equal(livingPlayers().length, 0);
        stepWorld(1 / 20);
        assert.equal(world.gameState, 'OVER');
    });

    test('an empty party with somebody still expected back is not', () => {
        world.pendingReturn = 1;
        for (let i = 0; i < 20; i++) stepWorld(1 / 20);
        assert.notEqual(world.gameState, 'OVER',
            'somebody whose wifi blinked came back to a defeat screen');
    });

    test('the loss lands the moment the grace runs out', () => {
        world.pendingReturn = 1;
        stepWorld(1 / 20);
        assert.notEqual(world.gameState, 'OVER');
        world.pendingReturn = 0;          // the server gave up holding their place
        stepWorld(1 / 20);
        assert.equal(world.gameState, 'OVER', 'the place was released and the match ran on');
    });

    test('a dead Nexus is a loss no matter who is coming back', () => {
        const p = new Player('warrior');
        world.players.push(p);
        world.pendingReturn = 2;
        world.base.hp = 0;
        stepWorld(1 / 20);
        assert.equal(world.gameState, 'OVER',
            'the Nexus fell and the match carried on because somebody might reconnect');
    });

    test('a living player keeps the match alive on their own', () => {
        world.players.push(new Player('warrior'));
        for (let i = 0; i < 20; i++) stepWorld(1 / 20);
        assert.equal(world.gameState, 'DAY');
    });
});
