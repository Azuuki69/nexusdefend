// Parties and the queue.
//
// End-to-end against a running `wrangler dev`, because the interesting behaviour is all in how
// two connections see each other: leadership, ready-gating, and a queue that must never split a
// party across two matches.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:8787';
const WS = 'ws://127.0.0.1:8787';

let up = false;
for (let attempt = 0; attempt < 4 && !up; attempt++) {
    try {
        up = (await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) })).ok;
    } catch { up = false; }
    if (!up) await new Promise(r => setTimeout(r, 500));
}
if (!up) console.log('  (wrangler dev not on :8787 - skipping lobby tests)');
const skip = up ? false : 'wrangler dev not running';

const open = new Set();
after(() => { for (const ws of open) { try { ws.close(); } catch {} } open.clear(); });

function connect(path) {
    const ws = new WebSocket(WS + path);
    open.add(ws);
    const msgs = [];
    ws.addEventListener('message', e => msgs.push(JSON.parse(e.data)));
    return {
        ws, msgs,
        ready: new Promise((res, rej) => {
            ws.addEventListener('open', res);
            ws.addEventListener('error', rej);
        }),
        send: o => ws.send(JSON.stringify(o)),
        close: () => { open.delete(ws); try { ws.close(); } catch {} },
        last: t => [...msgs].reverse().find(m => m.t === t),
        async until(pred, ms = 4000) {
            const deadline = Date.now() + ms;
            while (Date.now() < deadline) {
                const hit = pred(msgs);
                if (hit) return hit;
                await new Promise(r => setTimeout(r, 25));
            }
            throw new Error('timed out; last was ' + JSON.stringify(msgs.at(-1)));
        }
    };
}

describe('party', () => {
    test('a friend code is handed out, not chosen', { skip }, async () => {
        const a = await (await fetch(`${BASE}/api/party/new`)).json();
        const b = await (await fetch(`${BASE}/api/party/new`)).json();
        assert.match(a.code, /^[A-HJ-NP-Z2-9]{6}$/, 'not a readable code: ' + a.code);
        assert.notEqual(a.code, b.code, 'two parties got the same code');
        // No I, O, 0 or 1 - these get read out loud down a phone.
        assert.ok(!/[IO01]/.test(a.code), 'the alphabet contains characters that sound alike');
    });

    test('two people in one code see each other', { skip }, async () => {
        const { code } = await (await fetch(`${BASE}/api/party/new`)).json();
        const a = connect(`/ws/party/${code}?player=a&name=Alice&cls=warrior`);
        await a.ready;
        await a.until(m => m.find(x => x.t === 'party'));

        const b = connect(`/ws/party/${code}?player=b&name=Bob&cls=mage`);
        await b.ready;
        const seen = await b.until(m => m.find(x => x.t === 'party' && x.members.length === 2));
        assert.deepEqual(seen.members.map(m => m.name).sort(), ['Alice', 'Bob']);

        // and the first one through the door leads
        const leaders = seen.members.filter(m => m.leader);
        assert.equal(leaders.length, 1, 'expected exactly one leader');
        assert.equal(leaders[0].name, 'Alice');
        a.close(); b.close();
    });

    test('changing your class un-readies you', { skip }, async () => {
        const { code } = await (await fetch(`${BASE}/api/party/new`)).json();
        const a = connect(`/ws/party/${code}?player=a&name=A&cls=warrior`);
        await a.ready;
        await a.until(m => m.find(x => x.t === 'party'));
        a.send({ t: 'ready', ready: true });
        await a.until(m => m.find(x => x.t === 'party' && x.members[0].ready));
        a.send({ t: 'cls', cls: 'priest' });
        const after = await a.until(m => m.find(x => x.t === 'party' && x.members[0].cls === 'priest'));
        assert.equal(after.members[0].ready, false,
            'changed class but stayed ready, so you start as something you did not choose');
        a.close();
    });

    test('nobody starts until everybody is ready, and only the leader can', { skip }, async () => {
        const { code } = await (await fetch(`${BASE}/api/party/new`)).json();
        const a = connect(`/ws/party/${code}?player=a&name=A&cls=warrior`);
        const b = connect(`/ws/party/${code}?player=b&name=B&cls=mage`);
        await Promise.all([a.ready, b.ready]);
        await b.until(m => m.find(x => x.t === 'party' && x.members.length === 2));

        a.send({ t: 'start' });
        const refused = await a.until(m => m.find(x => x.t === 'error'));
        assert.match(refused.why, /ready/);

        a.send({ t: 'ready', ready: true });
        b.send({ t: 'ready', ready: true });
        await a.until(m => m.find(x => x.t === 'party' && x.members.every(p => p.ready)));

        // a non-leader asking is ignored
        b.send({ t: 'start' });
        await new Promise(r => setTimeout(r, 300));
        assert.equal(b.msgs.filter(m => m.t === 'start').length, 0, 'a non-leader started the match');

        a.send({ t: 'start' });
        const sa = await a.until(m => m.find(x => x.t === 'start'));
        const sb = await b.until(m => m.find(x => x.t === 'start'));
        assert.equal(sa.matchId, sb.matchId, 'the party was split across two matches');
        assert.ok(sa.matchId.startsWith('p-'), 'a party match should be identifiable');
        a.close(); b.close();
    });

    test('leadership does not die with the leader', { skip }, async () => {
        const { code } = await (await fetch(`${BASE}/api/party/new`)).json();
        const a = connect(`/ws/party/${code}?player=a&name=A&cls=warrior`);
        const b = connect(`/ws/party/${code}?player=b&name=B&cls=mage`);
        await Promise.all([a.ready, b.ready]);
        await b.until(m => m.find(x => x.t === 'party' && x.members.length === 2));
        a.close();
        const after = await b.until(m => m.find(x => x.t === 'party' && x.members.length === 1));
        assert.equal(after.members[0].leader, true,
            'the leader left and took leadership with them - the party can never start');
        b.close();
    });
});

describe('matchmaking', () => {
    test('two waiting players are put in the same match', { skip }, async () => {
        const a = connect('/ws/queue');
        await a.ready;
        a.send({ t: 'queue', ids: ['solo-a'] });
        const waiting = await a.until(m => m.find(x => x.t === 'waiting'));
        assert.equal(waiting.place, 1);

        const b = connect('/ws/queue');
        await b.ready;
        b.send({ t: 'queue', ids: ['solo-b'] });

        const ma = await a.until(m => m.find(x => x.t === 'matched'));
        const mb = await b.until(m => m.find(x => x.t === 'matched'));
        assert.equal(ma.matchId, mb.matchId, 'two queued players got different matches');
        assert.equal(ma.seed, mb.seed, 'same match, different seed - the worlds would differ');
        a.close(); b.close();
    });

    test('leaving the queue takes you out of it', { skip }, async () => {
        const a = connect('/ws/queue');
        await a.ready;
        a.send({ t: 'queue', ids: ['leaver'] });
        await a.until(m => m.find(x => x.t === 'waiting'));
        a.send({ t: 'leave' });
        await new Promise(r => setTimeout(r, 400));
        const status = await (await fetch(`${BASE}/api/queue/status`)).json();
        assert.equal(status.parties, 0, 'somebody who left is still in the queue');
        a.close();
    });

    test('a party queues as one entry so it cannot be split', { skip }, async () => {
        // Three friends must not be dealt across two matches. The queue counts seats, not
        // connections, which is the whole reason a party sends its member ids.
        const trio = connect('/ws/queue');
        await trio.ready;
        trio.send({ t: 'queue', ids: ['x', 'y', 'z'] });
        const seen = await trio.until(m => m.find(x => x.t === 'waiting'));
        assert.equal(seen.players, 3, 'the queue counted a party of three as one player');
        trio.close();
    });
});
