/**
 * Supabase JWT verification for Socket.IO authentication.
 */

const jwt = require('jsonwebtoken');

const LOG_PREFIX = '[auth]';
const NAME_MAX_LEN = 16;

/**
 * Returns true when server-side auth verification is configured.
 *
 * @returns {boolean}
 */
function isAuthConfigured() {
  return !!(
    (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) ||
    process.env.SUPABASE_JWT_SECRET
  );
}

/**
 * Verify a Supabase access token locally with the legacy JWT secret (HS256).
 *
 * @param {string} accessToken Supabase session access token.
 * @returns {object} Decoded JWT payload.
 */
function verifySupabaseToken(accessToken) {
  if (!process.env.SUPABASE_JWT_SECRET) {
    throw new Error('SUPABASE_JWT_SECRET is not configured');
  }
  return jwt.verify(accessToken, process.env.SUPABASE_JWT_SECRET, {
    algorithms: ['HS256'],
  });
}

/**
 * Verify a Supabase access token via the Auth server.
 * Works with both legacy HS256 and newer asymmetric signing keys.
 *
 * @param {string} accessToken Supabase session access token.
 * @returns {Promise<object>} Normalized JWT-like payload.
 */
async function verifyAccessTokenViaAuthServer(accessToken) {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY are required');
  }

  const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Auth server rejected token (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const user = await res.json();
  return {
    sub: user.id,
    email: user.email,
    user_metadata: user.user_metadata || {},
  };
}

/**
 * Verify a Supabase access token and return a normalized payload.
 *
 * @param {string} accessToken Supabase session access token.
 * @returns {Promise<object>} Normalized JWT-like payload.
 */
async function verifyAccessToken(accessToken) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    try {
      return await verifyAccessTokenViaAuthServer(accessToken);
    } catch (err) {
      if (!process.env.SUPABASE_JWT_SECRET) throw err;
      console.warn(`${LOG_PREFIX} Auth server verify failed, trying local JWT secret:`, err.message);
    }
  }

  return verifySupabaseToken(accessToken);
}

/**
 * Resolve the Google account name from a verified Supabase JWT payload.
 *
 * @param {object} payload Decoded JWT payload.
 * @returns {string}
 */
function resolveGoogleName(payload) {
  const meta = payload.user_metadata || {};
  const raw =
    meta.full_name ||
    meta.name ||
    (payload.email ? String(payload.email).split('@')[0] : '') ||
    'Player';
  const name = String(raw).trim().slice(0, 64);
  return name || 'Player';
}

/**
 * Resolve the saved in-game name from Supabase user metadata.
 *
 * @param {object} payload Decoded JWT payload or user object.
 * @returns {string|null}
 */
function resolveGamingNameFromPayload(payload) {
  const meta = payload.user_metadata || {};
  const name = String(meta.gaming_name || '').trim().slice(0, NAME_MAX_LEN);
  return name || null;
}

/**
 * Resolve avatar URL from a verified Supabase JWT payload.
 *
 * @param {object} payload Decoded JWT payload.
 * @returns {string|null}
 */
function resolveAvatarUrl(payload) {
  const meta = payload.user_metadata || {};
  return meta.avatar_url || meta.picture || null;
}

/**
 * Apply verified auth fields to a socket and persist the user when DB is ready.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} accessToken Supabase access token.
 * @param {object} db Database module.
 * @returns {Promise<void>}
 */
async function attachAuthToSocket(socket, accessToken, db) {
  const payload = await verifyAccessToken(accessToken);
  socket.authUserId = payload.sub;
  socket.authGoogleName = resolveGoogleName(payload);
  socket.authAvatarUrl = resolveAvatarUrl(payload);
  socket.authGamingName = resolveGamingNameFromPayload(payload);
  if (await db.ensureConnected()) {
    await db.upsertAuthUser({
      id: socket.authUserId,
      googleName: socket.authGoogleName,
      avatarUrl: socket.authAvatarUrl,
    });
    if (!socket.authGamingName) {
      socket.authGamingName = await db.getGamingName(socket.authUserId);
    } else {
      await db.saveGamingName(socket.authUserId, socket.authGamingName);
    }
  }
}

/**
 * Resolve the in-game player name from client input or saved gaming name.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} clientName Name sent by the client.
 * @returns {string}
 */
function resolvePlayerName(socket, clientName) {
  if (socket.authUserId) {
    const name = String(clientName || '').trim().slice(0, NAME_MAX_LEN);
    if (name) return name;
    if (socket.authGamingName) return socket.authGamingName;
    return '';
  }
  return String(clientName || '').trim().slice(0, NAME_MAX_LEN);
}

module.exports = {
  LOG_PREFIX,
  isAuthConfigured,
  verifySupabaseToken,
  verifyAccessToken,
  resolveGoogleName,
  resolveGamingNameFromPayload,
  resolveAvatarUrl,
  attachAuthToSocket,
  resolvePlayerName,
};
