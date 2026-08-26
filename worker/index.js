// HTTP entry point. Its only real job right now is routing a WebSocket upgrade to the
// Durable Object that owns a given match, so that every client for match "abc" reaches the
// same object no matter which edge location they connect from.

export { MatchRoom } from './match-room.js';

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
            const id = env.MATCH.idFromName(match[1]);
            return env.MATCH.get(id).fetch(request);
        }

        return new Response('not found', { status: 404 });
    }
};
