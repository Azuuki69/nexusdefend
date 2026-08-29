// Identity, and what a finished match leaves behind.
//
// The token half runs in plain Node against the real `identity.js`, because WebCrypto is the same
// there as it is in a Worker - forgery is worth testing without a server in the way.
//
// The persistence half runs end-to-end against `wrangler dev`, because the only thing worth
// proving is that a row actually lands in a real D1 and comes back out of a real HTTP route.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mintToken, readToken } from '../worker/identity.js';

const SECRET = 'a-test-secret';
const BASE = 'http://127.0.0.1:8787';

let up = false;
for (let attempt = 0; attempt < 4 && !up; attempt++) {
    try {
        up = (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) })).ok;
    } catch { up = false; }
    if (!up) await new Promise(r => setTimeout(r, 500));
}
if (!up) console.log('  (wrangler dev not on :8787 - skipping persistence tests)');
const skip = up ? false : 'wrangler dev not running';

describe('tokens', () => {
    test('a token says who you are and survives the round trip', async () => {
        const token = await mintToken('abc-123', SECRET);
        assert.equal(await readToken(token, SECRET), 'abc-123');
    });

    test('you cannot become somebody else by editing the id', async () => {
        const token = await mintToken('alice', SECRET);
        const forged = token.replace('alice', 'admin');
        assert.equal(await readToken(forged, SECRET), null,
            'changed the id in a token and the server believed it');
    });

    test('a token from a different secret is refused', async () => {
        const token = await mintToken('alice', 'some-other-secret');
        assert.equal(await readToken(token, SECRET), null);
    });

    test('an expired token stops working', async () => {
        const week = 7 * 24 * 60 * 60 * 1000;
        const token = await mintToken('alice', SECRET, Date.now() - week - 1000);
        assert.equal(await readToken(token, SECRET), null, 'an old token still opened the door');
    });

    test('rubbish is refused rather than crashing', async () => {
        for (const bad of ['', 'x', 'a.b', 'a.b.c.d', 'a.notanumber.sig', null, undefined, 42]) {
            assert.equal(await readToken(bad, SECRET), null, 'accepted: ' + String(bad));
        }
        // A signature that is not even base64 must not throw its way out of the request.
        assert.equal(await readToken(`x.${Date.now() + 10000}.!!!`, SECRET), null);
    });
});

describe('persistence', () => {
    test('signing in twice is the same person twice', { skip }, async () => {
        const first = await (await fetch(`${BASE}/api/identity`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Returning' })
        })).json();
        assert.match(first.id, /^[0-9a-f-]{8,40}$/i);
        assert.ok(first.token, 'no token was issued');

        const second = await (await fetch(`${BASE}/api/identity`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: first.id, name: 'Returning' })
        })).json();
        assert.equal(second.id, first.id, 'came back with a known id and was made a new person');
    });

    test('a claimed id that is not a uuid does not become one', { skip }, async () => {
        const res = await (await fetch(`${BASE}/api/identity`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: '../../etc/passwd', name: 'x' })
        })).json();
        assert.notEqual(res.id, '../../etc/passwd', 'the server took an id shaped like a path');
        assert.match(res.id, /^[0-9a-f-]{8,40}$/i);
    });

    test('a name is kept but not allowed to be a paragraph', { skip }, async () => {
        const res = await (await fetch(`${BASE}/api/identity`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'x'.repeat(500) })
        })).json();
        assert.ok(res.name.length <= 24, 'a 500-character name went into the database');
    });

    test('a new player has an empty record rather than no record', { skip }, async () => {
        const who = await (await fetch(`${BASE}/api/identity`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: 'Fresh' })
        })).json();
        const profile = await (await fetch(`${BASE}/api/profile/${who.id}`)).json();
        assert.equal(profile.stats.matches, 0);
        assert.deepEqual(profile.recent, [], 'a player who has never played has a match history');
    });

    test('asking for a replay that does not exist is a 404, not a 500', { skip }, async () => {
        const res = await fetch(`${BASE}/api/replay/no-such-match`);
        assert.equal(res.status, 404);
    });
});
