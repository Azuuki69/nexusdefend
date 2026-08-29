// A way in for players whose ISP cannot reach Cloudflare.
//
// Spanish ISPs block Cloudflare IP ranges under court orders obtained by LaLiga to fight
// football piracy, and those blocks catch Cloudflare's shared anycast addresses - which is every
// workers.dev and pages.dev site, including this one. Measured, not guessed: the same link opens
// from Poland and Turkey and fails from Spain and the Canary Islands, while the GitHub Pages copy
// (Fastly, different IPs) opens from all four.
//
// So the page is served from GitHub Pages, and this relay gives the match server an address that
// is not a Cloudflare address. It runs on Fly.io in Madrid: near the players who need it, and one
// short hop from Cloudflare's own Madrid edge.
//
// It deliberately holds no game logic. Every rule, every tick and every byte of the protocol
// stays in the Worker, where it is already deployed and tested - a relay that understood the game
// would be a second implementation to keep in step, which is the one thing this project has
// worked hardest to avoid.

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const UPSTREAM = process.env.UPSTREAM || 'nexusdefend.azuuki3.workers.dev';
const PORT = Number(process.env.PORT || 8080);

// The page lives on a different origin to this relay, so the browser asks permission before it
// will read an API response. WebSockets are exempt - they never had same-origin rules - but
// /api/identity is a plain fetch and would fail silently without these.
const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400'
};

const server = createServer(async (req, res) => {
    // Its own health, answered here rather than upstream, so "is the relay up" and "is the match
    // server up" are two questions with two answers.
    if (req.url === '/relay-health') {
        res.writeHead(200, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ ok: true, upstream: UPSTREAM, ts: Date.now() }));
        return;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
    }

    try {
        const body = req.method === 'GET' || req.method === 'HEAD'
            ? undefined
            : await readBody(req);

        const upstream = await fetch(`https://${UPSTREAM}${req.url}`, {
            method: req.method,
            headers: { 'content-type': req.headers['content-type'] || 'application/json' },
            body
        });

        const headers = { ...CORS };
        for (const [k, v] of upstream.headers) {
            // Two kinds of header must not be copied, and both corrupt the response.
            //
            // Hop-by-hop headers describe the connection we just made rather than the one we are
            // answering. And fetch() has already decompressed the body for us, so forwarding
            // `content-encoding: br` tells the browser to Brotli-decode bytes that are no longer
            // compressed - which is exactly how this failed the first time it was run.
            // content-length goes with it, because the decoded body is a different size.
            if (['transfer-encoding', 'connection', 'keep-alive',
                 'content-encoding', 'content-length'].includes(k.toLowerCase())) continue;
            headers[k] = v;
        }
        res.writeHead(upstream.status, headers);
        res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
        res.writeHead(502, { 'content-type': 'application/json', ...CORS });
        res.end(JSON.stringify({ error: 'relay could not reach the match server', detail: e.message }));
    }
});

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// ---------------------------------------------------------------- sockets
//
// A match is a WebSocket that stays open for the whole run, carrying 20 snapshots a second down
// and input up. Both directions are forwarded verbatim, binary included - the protocol is packed
// int16s and byte fractions, and anything that "helpfully" re-encoded it would break the game.

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (client) => {
        const target = new WebSocket(`wss://${UPSTREAM}${req.url}`);
        const pending = [];

        // The browser can start talking before the upstream socket is open. Holding those few
        // messages costs nothing; dropping them loses the first input of the match.
        const sendUp = data => {
            if (target.readyState === WebSocket.OPEN) target.send(data);
            else if (target.readyState === WebSocket.CONNECTING) pending.push(data);
        };

        target.on('open', () => {
            for (const m of pending) target.send(m);
            pending.length = 0;
        });

        client.on('message', (data, isBinary) => sendUp(isBinary ? data : data.toString()));
        target.on('message', (data, isBinary) => {
            if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });

        // Either end going away ends the match for this player, so the other side is told rather
        // than left holding a socket nobody is reading.
        const shut = (code, reason) => {
            const safe = code >= 1000 && code <= 4999 && code !== 1005 && code !== 1006 ? code : 1011;
            try { client.close(safe, reason); } catch { /* already gone */ }
            try { target.close(safe, reason); } catch { /* already gone */ }
        };
        client.on('close', (c, r) => shut(c, r));
        target.on('close', (c, r) => shut(c, r));
        client.on('error', () => shut(1011, 'client error'));
        target.on('error', () => shut(1011, 'upstream error'));
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`relay listening on :${PORT}, forwarding to ${UPSTREAM}`);
});
