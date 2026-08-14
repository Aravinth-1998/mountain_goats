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
  const teamMode = !!row.team_mode;
  let modeId = row.mode || (teamMode ? 'standardTeam' : 'standard');
  if (modeId === 'team') modeId = 'standardTeam';
  return {
    code: row.code,
    endedAt: Number(row.ended_at),
    startedAt: row.started_at != null ? Number(row.started_at) : null,
    durationMs: row.duration_ms != null ? Number(row.duration_ms) : null,
    playerCount: row.player_count,
    endReason: row.end_reason,
    abandoned: row.abandoned,
    modeId,
    teamMode,
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
    CREATE TABLE IF NOT EXISTS mg_game_history (
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
    CREATE INDEX IF NOT EXISTS idx_mg_game_history_ended_at
    ON mg_game_history (ended_at DESC)
  `);
    await p.query(`
    CREATE TABLE IF NOT EXISTS mg_users (
      id UUID PRIMARY KEY,
      display_name VARCHAR(64) NOT NULL DEFAULT '',
      gaming_name VARCHAR(16),
      google_name VARCHAR(64),
      avatar_url TEXT,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
    await p.query('ALTER TABLE mg_game_history ADD COLUMN IF NOT EXISTS mode VARCHAR(32)');
    await p.query(`
      UPDATE mg_game_history
      SET mode = CASE WHEN team_mode THEN 'standardTeam' ELSE 'standard' END
      WHERE mode IS NULL OR mode = 'team'
    `);
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS gaming_name VARCHAR(16)');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS google_name VARCHAR(64)');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS matches_played INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS matches_won INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS matches_lost INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS win_streak INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS best_win_streak INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS standard_matches_played INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS standard_matches_won INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS standard_matches_lost INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS team_matches_played INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS team_matches_won INT NOT NULL DEFAULT 0');
    await p.query('ALTER TABLE mg_users ADD COLUMN IF NOT EXISTS team_matches_lost INT NOT NULL DEFAULT 0');
    await p.query(`ALTER TABLE mg_users ALTER COLUMN display_name SET DEFAULT ''`);
    await p.query(`
      UPDATE mg_users SET display_name = COALESCE(NULLIF(display_name, ''), google_name, '')
      WHERE display_name IS NULL OR display_name = ''
    `);
    await p.query(`
      UPDATE mg_users SET gaming_name = LEFT(display_name, 16)
      WHERE gaming_name IS NULL AND display_name IS NOT NULL AND display_name <> ''
    `);
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
  await p.query('DELETE FROM mg_game_history WHERE ended_at < $1', [cutoff]);
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
            abandoned, team_mode, mode, winner, winner_team, players, teams
     FROM mg_game_history
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
    `INSERT INTO mg_game_history (
      code, ended_at, started_at, duration_ms, player_count, end_reason,
      abandoned, team_mode, mode, winner, winner_team, players, teams
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      entry.code,
      entry.endedAt,
      entry.startedAt,
      entry.durationMs,
      entry.playerCount,
      entry.endReason,
      entry.abandoned,
      entry.teamMode,
      entry.modeId || (entry.teamMode ? 'standardTeam' : 'standard'),
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
 * @returns {Promise<{ isNew: boolean, memberNumber: number|null }>} Insert result and community size when new.
 */
async function upsertAuthUser(user) {
  const p = getPool();
  if (!p || !connected) return { isNew: false, memberNumber: null };

  const googleName = String(user.googleName || '').trim().slice(0, 64) || 'Player';

  const result = await p.query(
    `INSERT INTO mg_users (id, display_name, google_name, avatar_url, last_seen_at)
     VALUES ($1, $2, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       google_name = EXCLUDED.google_name,
       avatar_url = EXCLUDED.avatar_url,
       last_seen_at = NOW()
     RETURNING (xmax = 0) AS is_new`,
    [user.id, googleName, user.avatarUrl || null]
  );

  const isNew = Boolean(result.rows[0] && result.rows[0].is_new);
  if (!isNew) return { isNew: false, memberNumber: null };

  const countResult = await p.query('SELECT COUNT(*)::int AS total FROM mg_users');
  const memberNumber = countResult.rows[0] ? Number(countResult.rows[0].total) : null;

  return { isNew: true, memberNumber };
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
     FROM mg_users WHERE id = $1`,
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

  const name = String(gamingName || '').trim().slice(0, 16);
  if (!name) return;

  await p.query(
    `INSERT INTO mg_users (id, display_name, gaming_name, last_seen_at)
     VALUES ($1, $2, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET
       gaming_name = EXCLUDED.gaming_name,
       last_seen_at = NOW()`,
    [userId, name]
  );
}

/**
 * Map a users row to normalized match stats.
 *
 * @param {object} row Database row.
 * @returns {{ played: number, won: number, lost: number, winStreak: number, bestWinStreak: number, standard: { played: number, won: number, lost: number }, team: { played: number, won: number, lost: number } }}
 */
function rowToMatchStats(row) {
  const standard = {
    played: Number(row.standard_matches_played),
    won: Number(row.standard_matches_won),
    lost: Number(row.standard_matches_lost),
  };
  const team = {
    played: Number(row.team_matches_played),
    won: Number(row.team_matches_won),
    lost: Number(row.team_matches_lost),
  };
  return {
    played: Number(row.matches_played),
    won: Number(row.matches_won),
    lost: Number(row.matches_lost),
    winStreak: Number(row.win_streak),
    bestWinStreak: Number(row.best_win_streak),
    standard,
    team,
    modes: { standard, team },
  };
}

/**
 * Ensure signed-in auth users exist before incrementing match stats.
 *
 * @param {string[]} userIds Supabase auth user ids.
 * @returns {Promise<void>}
 */
async function ensureAuthUserRows(userIds) {
  const p = getPool();
  if (!p || !connected || !userIds.length) return;

  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  for (const userId of uniqueIds) {
    await p.query(
      `INSERT INTO mg_users (id, display_name, last_seen_at)
       VALUES ($1, '', NOW())
       ON CONFLICT (id) DO NOTHING`,
      [userId]
    );
  }
}

/**
 * Increment match stats for signed-in users who finished a game.
 *
 * @param {{ userId: string, won: boolean, teamMode: boolean }[]} updates One entry per user.
 * @returns {Promise<Map<string, { played: number, won: number, lost: number, winStreak: number, bestWinStreak: number, standard: { played: number, won: number, lost: number }, team: { played: number, won: number, lost: number } }>>}
 */
async function recordMatchStats(updates) {
  const p = getPool();
  const resultMap = new Map();
  if (!p || !connected || !updates.length) return resultMap;

  await ensureAuthUserRows(updates.map((entry) => entry.userId));

  const params = [];
  const valueRows = updates.map((entry, index) => {
    const paramIndex = index * 3;
    params.push(entry.userId, entry.won, !!entry.teamMode);
    return `($${paramIndex + 1}::uuid, $${paramIndex + 2}::boolean, $${paramIndex + 3}::boolean)`;
  });

  const result = await p.query(
    `UPDATE mg_users AS u SET
       matches_played = u.matches_played + 1,
       matches_won = u.matches_won + CASE WHEN v.won THEN 1 ELSE 0 END,
       matches_lost = u.matches_lost + CASE WHEN v.won THEN 0 ELSE 1 END,
       standard_matches_played = u.standard_matches_played + CASE WHEN NOT v.team_mode THEN 1 ELSE 0 END,
       standard_matches_won = u.standard_matches_won + CASE WHEN NOT v.team_mode AND v.won THEN 1 ELSE 0 END,
       standard_matches_lost = u.standard_matches_lost + CASE WHEN NOT v.team_mode AND NOT v.won THEN 1 ELSE 0 END,
       team_matches_played = u.team_matches_played + CASE WHEN v.team_mode THEN 1 ELSE 0 END,
       team_matches_won = u.team_matches_won + CASE WHEN v.team_mode AND v.won THEN 1 ELSE 0 END,
       team_matches_lost = u.team_matches_lost + CASE WHEN v.team_mode AND NOT v.won THEN 1 ELSE 0 END,
       win_streak = CASE WHEN v.won THEN u.win_streak + 1 ELSE 0 END,
       best_win_streak = GREATEST(
         u.best_win_streak,
         CASE WHEN v.won THEN u.win_streak + 1 ELSE u.best_win_streak END
       )
     FROM (VALUES ${valueRows.join(', ')}) AS v(id, won, team_mode)
     WHERE u.id = v.id
     RETURNING u.id, u.matches_played, u.matches_won, u.matches_lost,
       u.win_streak, u.best_win_streak,
       u.standard_matches_played, u.standard_matches_won, u.standard_matches_lost,
       u.team_matches_played, u.team_matches_won, u.team_matches_lost`,
    params
  );

  result.rows.forEach((row) => {
    resultMap.set(row.id, rowToMatchStats(row));
  });
  return resultMap;
}

/**
 * Load match win/loss stats for a signed-in user.
 *
 * @param {string} userId Auth user UUID.
 * @returns {Promise<{ played: number, won: number, lost: number, winStreak: number, bestWinStreak: number, standard: { played: number, won: number, lost: number }, team: { played: number, won: number, lost: number } }|null>}
 */
async function getMatchStats(userId) {
  const p = getPool();
  if (!p || !connected || !userId) return null;

  const result = await p.query(
    `SELECT matches_played, matches_won, matches_lost,
            win_streak, best_win_streak,
            standard_matches_played, standard_matches_won, standard_matches_lost,
            team_matches_played, team_matches_won, team_matches_lost
     FROM mg_users
     WHERE id = $1`,
    [userId]
  );

  if (!result.rows.length) {
    return rowToMatchStats({
      matches_played: 0,
      matches_won: 0,
      matches_lost: 0,
      win_streak: 0,
      best_win_streak: 0,
      standard_matches_played: 0,
      standard_matches_won: 0,
      standard_matches_lost: 0,
      team_matches_played: 0,
      team_matches_won: 0,
      team_matches_lost: 0,
    });
  }

  return rowToMatchStats(result.rows[0]);
}

/**
 * Load top players by overall match wins for the public leaderboard.
 *
 * @param {number} [limit=10] Max rows to return.
 * @returns {Promise<Array<{ userId: string, name: string, wins: number, played: number, avatarUrl: string|null }>|null>}
 */
async function getLeaderboard(limit = 10) {
  const p = getPool();
  if (!p || !connected) return null;

  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const result = await p.query(
    `SELECT id, gaming_name, display_name, google_name, avatar_url,
            matches_won, matches_played
     FROM mg_users
     WHERE matches_played > 0
     ORDER BY matches_won DESC, matches_played ASC,
              COALESCE(NULLIF(gaming_name, ''), NULLIF(display_name, ''), NULLIF(google_name, ''), 'Player') ASC
     LIMIT $1`,
    [safeLimit]
  );

  return result.rows.map((row) => {
    const name =
      (row.gaming_name && String(row.gaming_name).trim()) ||
      (row.display_name && String(row.display_name).trim()) ||
      (row.google_name && String(row.google_name).trim()) ||
      'Player';
    return {
      userId: row.id,
      name: name.slice(0, 16),
      wins: Number(row.matches_won),
      played: Number(row.matches_played),
      avatarUrl: row.avatar_url || null,
    };
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
  upsertAuthUser,
  getGamingName,
  saveGamingName,
  ensureAuthUserRows,
  recordMatchStats,
  getMatchStats,
  getLeaderboard,
  ensureConnected,
  resetPool,
  close,
};
