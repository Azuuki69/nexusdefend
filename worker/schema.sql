-- What survives a match.
--
-- Deliberately small. A match is written once when it ends, never per tick - a Durable Object
-- writing to D1 twenty times a second would be a database with a game attached rather than the
-- other way round.
--
-- There are no passwords here and no email. Identity is a UUID the browser generates and keeps,
-- which the Worker signs; that is enough to say "this is the same person as last time" and
-- nothing more. The schema is shaped so a real account can be attached later without moving
-- anything: add columns to `players`, keep the id.

CREATE TABLE IF NOT EXISTS players (
    id          TEXT PRIMARY KEY,          -- the UUID the browser keeps
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS matches (
    id            TEXT PRIMARY KEY,
    seed          INTEGER NOT NULL,        -- with the input log, enough to replay the whole run
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    wave_reached  INTEGER NOT NULL DEFAULT 1,
    outcome       TEXT                     -- 'nexus_fell' | 'party_down' | 'abandoned'
);

CREATE TABLE IF NOT EXISTS match_players (
    match_id   TEXT NOT NULL,
    player_id  TEXT NOT NULL,
    class      TEXT NOT NULL,
    level      INTEGER NOT NULL DEFAULT 1,
    kills      INTEGER NOT NULL DEFAULT 0,
    damage     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, player_id)
);

-- Running totals, so a profile does not have to sum every match a player has ever played.
CREATE TABLE IF NOT EXISTS player_stats (
    player_id     TEXT PRIMARY KEY,
    matches       INTEGER NOT NULL DEFAULT 0,
    best_wave     INTEGER NOT NULL DEFAULT 0,
    total_kills   INTEGER NOT NULL DEFAULT 0,
    total_damage  INTEGER NOT NULL DEFAULT 0,
    updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_match_players_player ON match_players(player_id);
CREATE INDEX IF NOT EXISTS idx_matches_ended ON matches(ended_at);
