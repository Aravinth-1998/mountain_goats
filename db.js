/**
 * PostgreSQL persistence for game history.
 * Set DATABASE_URL (Neon, Supabase, Render Postgres, etc.) to enable.
 * Without it, server.js falls back to a local JSON file.
 *
 * Supabase on Render: use the Session pooler URL (not the direct db.*.supabase.co
 * host). Render often cannot reach Supabase direct connections over IPv6.
 */

const dns = require('dns');
const { Pool } = require('pg');

if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

const LOG_PREFIX = '[db]';

let pool = null;
let connected = false;

/**
 * Returns true when DATABASE_URL is configured.
 *
 * @returns {boolean}
 */
function isEnabled() {
  return !!process.env.DATABASE_URL;
}

/**
 * Returns true after a successful database init/connect.
 *
 * @returns {boolean}
 */
function isConnected() {
  return connected;
}

/**
 * Log a hint when Supabase direct host fails from IPv4-only hosts (e.g. Render).
 *
 * @param {Error} err Connection error.
 */
function logConnectionHint(err) {
  const url = process.env.DATABASE_URL || '';
  const msg = err && err.message ? err.message : '';
  if (url.includes('db.') && url.includes('.supabase.co') && /ENETUNREACH|ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    console.error(
      `${LOG_PREFIX} Hint: Supabase direct connection failed from this host. ` +
      'In Supabase Dashboard → Connect → use the Session pooler URI (host ends with .pooler.supabase.com, user postgres.PROJECT_REF).'
    );
  }
}

/**
 * Close and reset the pool after a failed connection.
 *
 * @returns {Promise<void>}
 */
async function resetPool() {
  connected = false;
  if (pool) {
    try {
      await pool.end();
    } catch (_) { /* ignore */ }
    pool = null;
  }
}

/**
 * Lazily create the connection pool.
 *
 * @returns {import('pg').Pool|null}
 */
function getPool() {
  if (!isEnabled()) return null;
  if (!pool) {
    const ssl =
      process.env.DATABASE_SSL === 'false'
        ? false
        : { rejectUnauthorized: false };
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl,
      max: 5,
      connectionTimeoutMillis: 15000,
    });
    pool.on('error', (err) => {
      console.error(`${LOG_PREFIX} Pool error:`, err.message);
      connected = false;
    });
  }
  return pool;
}

/**
 * Map a database row to the in-memory game history entry shape.
 *
 * @param {object} row Postgres row.
 * @returns {object}
 */
function rowToEntry(row) {
  return {
    code: row.code,
    endedAt: Number(row.ended_at),
    startedAt: row.started_at != null ? Number(row.started_at) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    playerCount: row.player_count,
    endReason: row.end_reason,
    abandoned: row.abandoned,
    teamMode: row.team_mode,
    winner: row.winner,
    winnerTeam: row.winner_team,
    players: row.players,
    teams: row.teams,
  };
}

/**
 * Create tables and prune expired history rows.
 *
 * @returns {Promise<boolean>} True when the database is ready.
 */
async function init() {
  const p = getPool();
  if (!p) return false;

  try {
    await p.query(`
    CREATE TABLE IF NOT EXISTS game_history (
      id SERIAL PRIMARY KEY,
      code VARCHAR(16) NOT NULL,
      ended_at BIGINT NOT NULL,
      started_at BIGINT,
      duration_ms BIGINT,
      player_count INT NOT NULL,
      end_reason VARCHAR(64),
      abandoned BOOLEAN NOT NULL DEFAULT FALSE,
      team_mode BOOLEAN NOT NULL DEFAULT FALSE,
      winner VARCHAR(64),
      winner_team VARCHAR(64),
      players JSONB NOT NULL,
      teams JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await p.query(`
    CREATE INDEX IF NOT EXISTS idx_game_history_ended_at
    ON game_history (ended_at DESC)
  `);
    await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      display_name VARCHAR(64) NOT NULL DEFAULT '',
      gaming_name VARCHAR(16),
      google_name VARCHAR(64),
      avatar_url TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await p.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS gaming_name VARCHAR(16)');
    await p.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_name VARCHAR(64)');
    await p.query(`
      UPDATE users SET gaming_name = LEFT(display_name, 16)
      WHERE gaming_name IS NULL AND display_name IS NOT NULL AND display_name <> ''
    `);
    await setupUserTablePolicies(p);
    connected = true;
    console.log(`${LOG_PREFIX} Schema ready`);
    return true;
  } catch (err) {
    logConnectionHint(err);
    await resetPool();
    throw err;
  }
}

/**
 * Allow signed-in Supabase users to read and update their own profile row
 * via the browser client (PostgREST + RLS).
 *
 * @param {import('pg').Pool} p Postgres pool.
 * @returns {Promise<void>}
 */
async function setupUserTablePolicies(p) {
  await p.query('ALTER TABLE users ENABLE ROW LEVEL SECURITY');
  await p.query('GRANT USAGE ON SCHEMA public TO authenticated');
  await p.query('GRANT SELECT, INSERT, UPDATE ON users TO authenticated');

  await p.query('DROP POLICY IF EXISTS users_select_own ON users');
  await p.query(`
    CREATE POLICY users_select_own ON users
    FOR SELECT TO authenticated
    USING (auth.uid() = id)
  `);

  await p.query('DROP POLICY IF EXISTS users_insert_own ON users');
  await p.query(`
    CREATE POLICY users_insert_own ON users
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = id)
  `);

  await p.query('DROP POLICY IF EXISTS users_update_own ON users');
  await p.query(`
    CREATE POLICY users_update_own ON users
    FOR UPDATE TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id)
  `);
}

/**
 * Ensure the database schema is ready (lazy init for API routes).
 *
 * @returns {Promise<boolean>}
 */
async function ensureConnected() {
  if (connected) return true;
  if (!isEnabled()) return false;
  try {
    return await init();
  } catch (err) {
    console.error(`${LOG_PREFIX} ensureConnected failed:`, err.message);
    return false;
  }
}

/**
 * Delete game history rows older than the retention window.
 *
 * @param {number} retentionMs Milliseconds to keep.
 * @returns {Promise<void>}
 */
async function pruneGameHistory(retentionMs) {
  const p = getPool();
  if (!p) return;
  const cutoff = Date.now() - retentionMs;
  await p.query('DELETE FROM game_history WHERE ended_at < $1', [cutoff]);
}

/**
 * Load recent game history from the database.
 *
 * @param {number} retentionMs Milliseconds of history to load.
 * @returns {Promise<object[]>}
 */
async function loadGameHistory(retentionMs) {
  const p = getPool();
  if (!p) return [];

  await pruneGameHistory(retentionMs);
  const cutoff = Date.now() - retentionMs;
  const result = await p.query(
    `SELECT code, ended_at, started_at, duration_ms, player_count, end_reason,
            abandoned, team_mode, winner, winner_team, players, teams
     FROM game_history
     WHERE ended_at >= $1
     ORDER BY ended_at DESC`,
    [cutoff]
  );
  return result.rows.map(rowToEntry);
}

/**
 * Persist one completed or abandoned game.
 *
 * @param {object} entry Game history entry.
 * @returns {Promise<void>}
 */
async function saveGameHistory(entry) {
  const p = getPool();
  if (!p) return;

  await p.query(
    `INSERT INTO game_history (
      code, ended_at, started_at, duration_ms, player_count, end_reason,
      abandoned, team_mode, winner, winner_team, players, teams
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      entry.code,
      entry.endedAt,
      entry.startedAt,
      entry.durationMs,
      entry.playerCount,
      entry.endReason,
      entry.abandoned,
      entry.teamMode,
      entry.winner,
      entry.winnerTeam,
      JSON.stringify(entry.players),
      entry.teams ? JSON.stringify(entry.teams) : null,
    ]
  );
}

/**
 * Insert or update OAuth profile fields without overwriting the gaming name.
 *
 * @param {object} user User fields.
 * @param {string} user.id Supabase auth user id (JWT sub).
 * @param {string} user.googleName Google display name.
 * @param {string|null} [user.avatarUrl] Avatar URL.
 * @returns {Promise<void>}
 */
async function upsertAuthUser(user) {
  const p = getPool();
  if (!p || !connected) return;

  await p.query(
    `INSERT INTO users (id, google_name, avatar_url, display_name, last_seen_at)
     VALUES ($1, $2, $3, '', NOW())
     ON CONFLICT (id) DO UPDATE SET
       google_name = EXCLUDED.google_name,
       avatar_url = EXCLUDED.avatar_url,
       last_seen_at = NOW()`,
    [user.id, user.googleName, user.avatarUrl || null]
  );
}

/**
 * Load a user's saved in-game name.
 *
 * @param {string} userId Supabase auth user id.
 * @returns {Promise<string|null>}
 */
async function getGamingName(userId) {
  const p = getPool();
  if (!p || !connected) return null;

  const result = await p.query(
    `SELECT gaming_name, display_name
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!result.rows.length) return null;
  const row = result.rows[0];
  if (row.gaming_name) return row.gaming_name;
  if (row.display_name) return String(row.display_name).trim().slice(0, 16) || null;
  return null;
}

/**
 * Save a user's chosen in-game name.
 *
 * @param {string} userId Supabase auth user id.
 * @param {string} gamingName In-game display name.
 * @returns {Promise<void>}
 */
async function saveGamingName(userId, gamingName) {
  const p = getPool();
  if (!p || !connected) {
    console.warn(`${LOG_PREFIX} saveGamingName skipped: database not connected`);
    return;
  }

  await p.query(
    `INSERT INTO users (id, gaming_name, last_seen_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       gaming_name = EXCLUDED.gaming_name,
       last_seen_at = NOW()`,
    [userId, gamingName]
  );
}

/**
 * @deprecated Use upsertAuthUser instead.
 * @param {object} user User fields.
 * @returns {Promise<void>}
 */
async function upsertUser(user) {
  await upsertAuthUser({
    id: user.id,
    googleName: user.displayName,
    avatarUrl: user.avatarUrl,
  });
}

/**
 * Close the pool (for graceful shutdown).
 *
 * @returns {Promise<void>}
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  isEnabled,
  isConnected,
  init,
  loadGameHistory,
  saveGameHistory,
  pruneGameHistory,
  upsertUser,
  upsertAuthUser,
  getGamingName,
  saveGamingName,
  ensureConnected,
  resetPool,
  close,
};
