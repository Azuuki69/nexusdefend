// The front menu.
//
// The class cards used to BE the menu: clicking Warrior started a game, and multiplayer was
// only reachable from the console. Now there is a title, three choices, and a class picker both
// modes share.
//
// These are structural checks against the markup. The flows themselves were driven in a real
// browser - both modes started a game, Back went back, and a join against a host with no match
// server failed with a message instead of a stack trace.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

test('the game says its own name at the top of the menu', () => {
    const menu = SRC.slice(SRC.indexOf('id="mainMenu"'), SRC.indexOf('id="menuHome"'));
    assert.ok(/<h1>DEFEND THE NEXUS<\/h1>/.test(menu), 'the title is gone from the menu');
});

test('the menu offers the three choices', () => {
    for (const [label, fn] of [['Single-player', 'menuSingle()'],
                               ['Multiplayer', 'menuMulti()'],
                               ['Settings', 'menuSettings()']]) {
        const re = new RegExp('<button class="menu-btn" onclick="' + fn.replace('(', '\\(').replace(')', '\\)') + '">' + label);
        assert.ok(re.test(SRC), 'no ' + label + ' button wired to ' + fn);
    }
});

test('the three screens exist and only the first is shown', () => {
    for (const id of ['menuHome', 'menuClass', 'menuMatch'])
        assert.ok(SRC.includes('id="' + id + '"'), 'missing screen: ' + id);
    assert.ok(/id="menuHome" class="menu-screen">/.test(SRC), 'the menu does not open on the home screen');
    assert.ok(/id="menuClass" class="menu-screen hidden"/.test(SRC), 'the class picker starts visible');
    assert.ok(/id="menuMatch" class="menu-screen hidden"/.test(SRC), 'the match screen starts visible');
});

test('a class card chooses a class rather than starting a game', () => {
    // Otherwise Multiplayer would drop you straight into a single-player run.
    for (const cls of ['warrior', 'mage', 'archer', 'priest'])
        assert.ok(SRC.includes(`onclick="menuPick('${cls}')"`), 'no card for ' + cls);
    assert.ok(!/onclick="startGame\('/.test(SRC),
        'a class card still starts a game directly, bypassing the mode choice');
});

test('picking a class means the same thing in both modes', () => {
    // One picker, one handler; the mode decides where it leads.
    assert.ok(/function menuPick\(cls\) \{[\s\S]*?if \(menuMode === 'local'\) \{ startGame\(cls\); return; \}/.test(SRC),
        'menuPick does not branch on the mode');
    assert.ok(/showMenuScreen\('menuMatch'\)/.test(SRC), 'multiplayer never reaches the match screen');
});

test('every menu handler the markup calls is bridged onto window', () => {
    const used = new Set();
    for (const m of SRC.matchAll(/\bonclick="(menu[A-Za-z]*)\(/g)) used.add(m[1]);
    assert.ok(used.size >= 5, 'only found ' + used.size + ' menu handlers');
    const bridge = SRC.slice(SRC.indexOf('Object.assign(window, {'));
    const bridged = new Set(bridge.slice(0, bridge.indexOf('}')).match(/[A-Za-z_$][\w$]*/g) || []);
    const missing = [...used].filter(n => !bridged.has(n));
    assert.deepEqual(missing, [], 'dead menu buttons: ' + missing.join(', '));
});

test('a match name is cleaned rather than rejected', () => {
    // Whatever someone types has to survive being a URL path segment.
    const fn = SRC.slice(SRC.indexOf('async function menuJoin()'));
    assert.ok(/replace\(\/\[\^a-z0-9_-\]\+\/g, '-'\)/.test(fn), 'punctuation is not replaced');
    assert.ok(/replace\(\/-\{2,\}\/g, '-'\)/.test(fn), 'runs of dashes are not collapsed');
    assert.ok(/slice\(0, 24\)/.test(fn), 'the name is not length-limited');
    assert.ok(/Give the match a name first/.test(fn), 'an empty name is not caught');
});

test('a join that cannot reach a server says so', () => {
    // Served from GitHub Pages there is no worker behind it, and the failure has to read as an
    // explanation rather than as a broken game.
    const fn = SRC.slice(SRC.indexOf('async function menuJoin()'));
    assert.ok(/catch \(e\)/.test(fn), 'a failed join is unhandled');
    assert.ok(/Could not reach a match server/.test(fn), 'the failure has no message');
});

test('settings from the menu hides what only means something mid-run', () => {
    assert.ok(/function menuSettings\(\)[\s\S]*?getElementById\('retryBtn'\)\.classList\.add\('hidden'\)/.test(SRC),
        'Retry Run is offered with no run to retry');
    assert.ok(/function menuSettings\(\)[\s\S]*?getElementById\('quitBtn'\)\.classList\.add\('hidden'\)/.test(SRC),
        'Main Menu is offered while already at the main menu');
    // and opening it during a run must put them back
    assert.ok(/function openSettings\(\)[\s\S]*?getElementById\('retryBtn'\)\.classList\.remove\('hidden'\)/.test(SRC),
        'once hidden from the menu, Retry never comes back');
});

test('leaving a run returns to the front screen and drops the match', () => {
    const fn = SRC.slice(SRC.indexOf('function resetGameToMenu()'), SRC.indexOf('function resetGameToMenu()') + 600);
    assert.ok(/leaveMatch\(\);/.test(fn), 'quitting a match leaves the socket open');
    assert.ok(/menuHome\(\);/.test(fn), 'the menu reopens wherever it was left');
});
