// HTTP entry point.
//
// Static assets are matched first, so the game client and its sprites are served straight
// from the edge and never reach this code. Anything with no matching file falls through to
// here, which is where the API and the WebSocket upgrade live. Same origin for all of it.

export { MatchRoom } from './match-room.js';
export { PartyRoom, makePartyCode } from './party-room.js';
export { Matchmaker } from './matchmaker.js';

import { mintToken, readToken, signingSecret, rememberPlayer } from './identity.js';

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({ ok: true, ts: Date.now() });
        }

        // /ws/match/<id> - idFromName means the same match id always resolves to the same
        // object instance globally, which is the property the whole design rests on.
        const match = url.pathname.match(/^\/ws\/match\/([A-Za-z0-9_-]{1,64})$/);
        if (match) {
            if (request.headers.get('Upgrade') !== 'websocket') {
                return new Response('expected a websocket upgrade', { status: 426 });
            }
            // A token, if the client has one. The match trusts what this says and nothing
            // the client claims about itself.
            const claimed = url.searchParams.get('token');
            const verified = claimed ? await readToken(claimed, signingSecret(env)) : null;
            const id = env.MATCH.idFromName(match[1]);
            const fwd = new Request(request);
            fwd.headers.set('X-Player-Id', verified || '');
            return env.MATCH.get(id).fetch(fwd);
        }

        // --- identity -----------------------------------------------------------------
        // The browser keeps a UUID; this signs it. No password, no email: enough to say "the
        // same person as last time" and deliberately nothing more.
        if (url.pathname === '/api/identity' && request.method === 'POST') {
            let body = {};
            try { body = await request.json(); } catch { /* an empty body is a new player */ }
            const id = /^[0-9a-f-]{8,40}$/i.test(String(body.id || '')) ? body.id : crypto.randomUUID();
            const name = String(body.name || '').slice(0, 24) || 'player';
            await rememberPlayer(env, id, name);
            return Response.json({ id, name, token: await mintToken(id, signingSecret(env)) });
        }

        // What one player has to show for themselves.
        const profile = url.pathname.match(/^\/api\/profile\/([0-9a-fA-F-]{8,40})$/);
        if (profile && env.DB) {
            const stats = await env.DB.prepare(
                'SELECT * FROM player_stats WHERE player_id = ?').bind(profile[1]).first();
            const recent = await env.DB.prepare(
                `SELECT m.id, m.seed, m.wave_reached, m.outcome, m.ended_at,
                        mp.class, mp.level, mp.kills, mp.damage
                 FROM match_players mp JOIN matches m ON m.id = mp.match_id
                 WHERE mp.player_id = ? ORDER BY m.ended_at DESC LIMIT 10`
            ).bind(profile[1]).all();
            return Response.json({
                stats: stats || { matches: 0, best_wave: 0, total_kills: 0, total_damage: 0 },
                recent: recent.results || []
            });
        }

        // A whole run, from a seed and the inputs that produced it.
        const replay = url.pathname.match(/^\/api\/replay\/([A-Za-z0-9_-]{1,64})$/);
        if (replay && env.REPLAYS) {
            const stored = await env.REPLAYS.get('replay:' + replay[1], 'json');
            if (!stored) return new Response('no such replay', { status: 404 });
            return Response.json(stored);
        }

        // A friend code, handed out rather than chosen, so two parties cannot collide.
        if (url.pathname === '/api/party/new') {
            const { makePartyCode } = await import('./party-room.js');
            return Response.json({ code: makePartyCode() });
        }

        // /ws/party/<code> - the lobby you and your friends sit in before a match exists.
        const party = url.pathname.match(/^\/ws\/party\/([A-Za-z0-9]{4,12})$/);
        if (party) {
            const id = env.PARTY.idFromName(party[1].toUpperCase());
            return env.PARTY.get(id).fetch(request);
        }

        // /ws/queue - one queue for the whole game, which is right at this scale.
        if (url.pathname === '/ws/queue' || url.pathname === '/api/queue/status') {
            const id = env.MATCHMAKER.idFromName('global');
            return env.MATCHMAKER.get(id).fetch(request);
        }

        // Anything that is not an API or a socket is a file.
        //
        // On Workers Static Assets this rarely runs, because assets are served before the Worker
        // is even invoked. On Pages a _worker.js receives EVERY request, so without this the
        // whole game would 404 and only the API would answer. Correct in both, which is the
        // point - one codebase, two front doors.
        if (env.ASSETS) return env.ASSETS.fetch(request);
        return new Response('not found', { status: 404 });
    }
};
