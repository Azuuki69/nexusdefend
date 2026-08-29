// The queue: people who want a match and do not care who with.
//
// One object for the whole game, which is right at friends-scale and would be sharded by region
// or mode long before it was not. It is deliberately dumb - first in, first matched - because
// skill rating on a co-op survival game would be inventing a problem.
//
// A party queues as one entry rather than as several. Otherwise a group of three could be split
// across two matches, which is the one outcome a queue must never produce.
//
// Like PartyRoom this hibernates: a queue with nobody in it should cost nothing. The timer is
// the exception - somebody waiting alone has to eventually be given a match anyway - and that
// is an alarm rather than a setTimeout, because an alarm survives eviction and a timer does not.

const MAX_PLAYERS = 4;
const LONELY_MS = 12_000;        // waited long enough; start one anyway
const SWEEP_MS = 2_000;

export class Matchmaker {
    constructor(state, env) {
        this.state = state;
        this.env = env;
        /** @type {Map<string, {ids, size, joinedAt}>} keyed by ticket */
        this.waiting = null;
    }

    async load() {
        if (this.waiting) return this.waiting;
        this.waiting = new Map(await this.state.storage.get('waiting') || []);
        return this.waiting;
    }

    async save() {
        await this.state.storage.put('waiting', [...this.waiting]);
    }

    async fetch(request) {
        const url = new URL(request.url);
        if (request.headers.get('Upgrade') !== 'websocket') {
            if (url.pathname.endsWith('/status')) {
                const waiting = await this.load();
                return Response.json({
                    parties: waiting.size,
                    players: [...waiting.values()].reduce((n, e) => n + e.size, 0)
                });
            }
            return new Response('expected a websocket upgrade', { status: 426 });
        }

        const ticket = crypto.randomUUID().slice(0, 12);
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        this.state.acceptWebSocket(server, [ticket]);
        server.send(JSON.stringify({ t: 'queued', ticket }));
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws, raw) {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const ticket = this.state.getTags(ws)[0];
        const waiting = await this.load();

        if (msg.t === 'queue') {
            // A party arrives as one entry carrying everybody's id, so it cannot be split.
            const ids = Array.isArray(msg.ids) ? msg.ids.slice(0, MAX_PLAYERS).map(String) : [];
            const size = Math.max(1, Math.min(MAX_PLAYERS, ids.length || 1));
            waiting.set(ticket, { ids, size, joinedAt: Date.now() });
            await this.save();
            await this.state.storage.setAlarm(Date.now() + SWEEP_MS);
            this.tellEveryoneWhereTheyStand();
            await this.tryToForm();
        } else if (msg.t === 'leave') {
            waiting.delete(ticket);
            await this.save();
            this.tellEveryoneWhereTheyStand();
        }
    }

    async webSocketClose(ws) { await this.dropTicket(ws); }
    async webSocketError(ws) { await this.dropTicket(ws); }

    async dropTicket(ws) {
        const ticket = this.state.getTags(ws)[0];
        const waiting = await this.load();
        if (waiting.delete(ticket)) {
            await this.save();
            this.tellEveryoneWhereTheyStand();
        }
    }

    /** Somebody has been waiting alone long enough to deserve a match of their own. */
    async alarm() {
        const waiting = await this.load();
        if (!waiting.size) return;
        await this.tryToForm(true);
        if (this.waiting.size) await this.state.storage.setAlarm(Date.now() + SWEEP_MS);
    }

    /**
     * Fill a match from the front of the queue.
     *
     * `impatient` is the alarm asking for anybody who has waited past LONELY_MS to be started
     * on their own rather than left sitting there.
     */
    async tryToForm(impatient = false) {
        const waiting = await this.load();
        const order = [...waiting.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt);

        let group = [], seats = 0;
        for (const [ticket, entry] of order) {
            if (seats + entry.size > MAX_PLAYERS) continue;   // a party that will not fit waits
            group.push([ticket, entry]);
            seats += entry.size;
            if (seats >= 2) break;                            // two is a match
        }

        const oldestWait = order.length ? Date.now() - order[0][1].joinedAt : 0;
        const enough = seats >= 2 || (impatient && oldestWait >= LONELY_MS && order.length);
        if (!enough) return;

        if (seats < 2) group = [order[0]];                    // starting somebody on their own

        const matchId = 'q-' + crypto.randomUUID().slice(0, 12);
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;

        const tickets = new Set(group.map(([t]) => t));
        for (const ws of this.state.getWebSockets()) {
            const t = this.state.getTags(ws)[0];
            if (!tickets.has(t)) continue;
            try { ws.send(JSON.stringify({ t: 'matched', matchId, seed })); } catch { /* gone */ }
        }
        for (const [t] of group) waiting.delete(t);
        await this.save();
        this.tellEveryoneWhereTheyStand();
    }

    /** Position in the queue is the only thing anybody waiting actually wants to know. */
    tellEveryoneWhereTheyStand() {
        const waiting = this.waiting || new Map();
        const order = [...waiting.entries()].sort((a, b) => a[1].joinedAt - b[1].joinedAt);
        const place = new Map(order.map(([t], i) => [t, i + 1]));
        const players = order.reduce((n, [, e]) => n + e.size, 0);
        for (const ws of this.state.getWebSockets()) {
            const t = this.state.getTags(ws)[0];
            if (!place.has(t)) continue;
            try {
                ws.send(JSON.stringify({ t: 'waiting', place: place.get(t), players }));
            } catch { /* gone */ }
        }
    }
}
