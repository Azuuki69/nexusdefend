// Who somebody is, with no password involved.
//
// The browser generates a UUID and keeps it. The Worker signs it and hands back a token; the
// token is what a Durable Object trusts, because a DO has no database of its own and should not
// be asking one whether a stranger is real.
//
// This proves continuity, not identity. Anyone who copies your UUID is you, and that is the
// honest bargain for a game with no sign-up: it is enough to say "the same person as last
// time", and it is not enough to protect anything that matters. The schema is shaped so a real
// account can be attached later without moving anything.
//
// The signature is HMAC-SHA256 over `id.expiry`, which is the smallest thing that stops a
// client inventing somebody else's id.

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes) {
    let s = '';
    for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function key(secret) {
    return crypto.subtle.importKey('raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** `<id>.<expiry>.<signature>` - short enough for a query string. */
export async function mintToken(id, secret, now = Date.now()) {
    const expiry = now + TOKEN_TTL_MS;
    const body = `${id}.${expiry}`;
    const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
    return `${body}.${b64url(sig)}`;
}

/** The player id if the token is genuine and current, otherwise null. */
export async function readToken(token, secret, now = Date.now()) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [id, expiryStr, sig] = parts;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || expiry < now) return null;

    let ok = false;
    try {
        // verify() rather than comparing strings: a character-by-character comparison leaks
        // how much of a forged signature was right.
        ok = await crypto.subtle.verify('HMAC', await key(secret), unb64url(sig),
            enc.encode(`${id}.${expiry}`));
    } catch { return null; }
    return ok ? id : null;
}

/**
 * The secret. In production this is a Worker secret; locally there is none, so a fixed
 * development value is used and said out loud rather than pretended about.
 */
export function signingSecret(env) {
    return env.IDENTITY_SECRET || 'nexus-development-secret-not-for-production';
}

/** First sight of a player, or an update to when they were last around. */
export async function rememberPlayer(env, id, name, now = Date.now()) {
    if (!env.DB) return;
    await env.DB.prepare(
        `INSERT INTO players (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen`
    ).bind(id, String(name || 'player').slice(0, 24), now, now).run();
}
