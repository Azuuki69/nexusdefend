// A party: the people you intend to play with, before there is anything to play.
//
// One object per friend code. Members join by typing the code, pick a class, say they are
// ready, and the leader starts the match - at which point everybody is told the same match id
// and the party stops mattering.
//
// This one DOES use the Hibernation API, and that is the whole difference between it and
// MatchRoom. A party spends almost all of its life doing nothing: four people staring at a
// lobby is four sockets and no work. Hibernation evicts the object between messages and brings
// it back when one arrives, which costs nothing while idle. MatchRoom cannot do that because
// eviction would kill its tick timer mid-match; a party has no timer to kill.
//
// The consequence is that everything worth keeping has to survive eviction, so member state
// lives in storage rather than in a field. `this.members` is a cache, not the truth.

const MAX_MEMBERS = 4;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no I/O/0/1 - these get read aloud
const CLASSES = new Set(['warrior', 'mage', 'archer', 'priest']);
const PARTY_TTL_MS = 2 * 60 * 60 * 1000;                    // a lobby nobody returned to

/** A code someone can say down a phone without spelling it. */
export function makePartyCode(random = crypto.getRandomValues.bind(crypto)) {
    const bytes = random(new Uint8Array(6));
    let out = '';
    for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    return out;
}

export class PartyRoom {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        /** @type {Map<string, {id, name, cls, ready, leader}>} cache of what is in storage */
        this.members = null;
    }

    async load() {
        if (this.members) return this.members;
        const stored = await this.state.storage.get('members');
        this.members = new Map(stored || []);
        return this.members;
    }

    async save() {
        await this.state.storage.put('members', [...this.members]);
        await this.state.storage.setAlarm(Date.now() + PARTY_TTL_MS);
    }

    /** Nobody came back. Let the object go. */
    async alarm() {
        await this.state.storage.deleteAll();
    }

    async fetch(request) {
        const url = new URL(request.url);
        const id = (url.searchParams.get('player') || '').slice(0, 32) || crypto.randomUUID();
        const name = (url.searchParams.get('name') || '').slice(0, 16) || 'player';
        const cls = url.searchParams.get('cls');

        if (request.headers.get('Upgrade') !== 'websocket') {
            return new Response('expected a websocket upgrade', { status: 426 });
        }

        const members = await this.load();
        if (!members.has(id) && members.size >= MAX_MEMBERS) {
            return new Response('party is full', { status: 409 });
        }

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        // Hibernation, deliberately: see the note at the top. The tag is how a socket is
        // matched back to its member after the object has been evicted and rebuilt.
        this.state.acceptWebSocket(server, [id]);

        members.set(id, {
            id, name,
            cls: CLASSES.has(cls) ? cls : 'warrior',
            ready: false,
            // The first person through the door leads, and leadership moves on if they go.
            leader: members.size === 0 || [...members.values()].every(m => !m.leader)
        });
        await this.save();

        server.send(JSON.stringify({ t: 'you', id, code: url.pathname.split('/').pop() }));
        this.broadcast();
        return new Response(null, { status: 101, webSocket: client });
    }

    /** Hibernation delivers messages here rather than to an addEventListener. */
    async webSocketMessage(ws, raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        const id = this.state.getTags(ws)[0];
        const members = await this.load();
        const me = members.get(id);
        if (!me) return;

        if (msg.t === 'cls' && CLASSES.has(msg.cls)) {
            me.cls = msg.cls;
            me.ready = false;              // changing your mind un-readies you
        } else if (msg.t === 'ready') {
            me.ready = !!msg.ready;
        } else if (msg.t === 'name') {
            me.name = String(msg.name || '').slice(0, 16) || me.name;
        } else if (msg.t === 'start') {
            // Only the leader, and only when everyone has said yes.
            if (!me.leader) return;
            const all = [...members.values()];
            if (!all.every(m => m.ready)) {
                ws.send(JSON.stringify({ t: 'error', why: 'not everyone is ready' }));
                return;
            }
            const matchId = 'p-' + (await this.matchIdFor(all));
            const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
            this.broadcast({ t: 'start', matchId, seed });
            return;
        } else {
            return;
        }

        await this.save();
        this.broadcast();
    }

    async webSocketClose(ws) { await this.leave(ws); }
    async webSocketError(ws) { await this.leave(ws); }

    async leave(ws) {
        const id = this.state.getTags(ws)[0];
        const members = await this.load();
        const was = members.get(id);
        members.delete(id);
        // Leadership does not die with the leader.
        if (was && was.leader) {
            const next = members.values().next().value;
            if (next) next.leader = true;
        }
        await this.save();
        this.broadcast();
    }

    /** One match id per party, stable for as long as the party is. */
    async matchIdFor(all) {
        let id = await this.state.storage.get('matchId');
        if (!id) {
            id = crypto.randomUUID().slice(0, 12);
            await this.state.storage.put('matchId', id);
        }
        return id;
    }

    broadcast(extra) {
        const members = this.members ? [...this.members.values()] : [];
        const payload = JSON.stringify(extra || { t: 'party', members });
        for (const ws of this.state.getWebSockets()) {
            try { ws.send(payload); } catch { /* it will be cleaned up by the close handler */ }
        }
    }
}
