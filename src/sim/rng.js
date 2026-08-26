// Seeded randomness for the simulation.
//
// The game shipped with 63 bare Math.random() calls, which meant no run could ever be
// reproduced: no replays, and no way to write a test that asserts anything about a wave.
// Once the simulation is authoritative on a server that matters more, because the server
// and any replay of it have to agree.
//
// mulberry32: one 32-bit word of state, good distribution, and short enough to be obviously
// correct. Not cryptographic - it is not guarding anything, it is making runs repeatable.

/**
 * @param {number} seed  any 32-bit integer
 * @returns {() => number} float in [0, 1), same sequence for the same seed
 */
export function mulberry32(seed) {
    let a = seed >>> 0;
    return function rng() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * A small bundle of the shapes the game actually asks for, so call sites read as intent
 * rather than arithmetic. Every method draws from the same stream, so the order of calls
 * is part of the seed's meaning - reordering calls changes the run.
 */
export function createRandom(seed) {
    const next = mulberry32(seed);
    return {
        seed,
        /** float in [0, 1) */
        next,
        /** float in [min, max) */
        range: (min, max) => min + next() * (max - min),
        /** integer in [min, max] inclusive */
        int: (min, max) => min + Math.floor(next() * (max - min + 1)),
        /** true with the given probability */
        chance: (p) => next() < p,
        /** a random member, or undefined for an empty list */
        pick: (arr) => (arr.length ? arr[Math.floor(next() * arr.length)] : undefined),
        /** random angle in radians */
        angle: () => next() * Math.PI * 2,
        /** -1 or 1 */
        sign: () => (next() < 0.5 ? -1 : 1)
    };
}

/**
 * Seeds are exchanged between server and client and shown to players, so keep them to a
 * readable positive integer rather than a float.
 */
export function randomSeed() {
    return (Math.random() * 0xFFFFFFFF) >>> 0;
}
