/**
 * Supabase JWT verification for Socket.IO authentication.
 */

const jwt = require('jsonwebtoken');

const LOG_PREFIX = '[auth]';
const NAME_MAX_LEN = 16;

/**
 * Returns true when Supabase JWT verification is configured.
 *
 * @returns {boolean}
 */
function isAuthConfigured() {
  return !!process.env.SUPABASE_JWT_SECRET;
}

/**
 * Verify a Supabase access token and return the decoded payload.
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
 * Resolve a display name from a verified Supabase JWT payload.
 *
 * @param {object} payload Decoded JWT payload.
 * @returns {string}
 */
function resolveDisplayName(payload) {
  const meta = payload.user_metadata || {};
  const raw =
    meta.full_name ||
    meta.name ||
    (payload.email ? String(payload.email).split('@')[0] : '') ||
    'Player';
  const name = String(raw).trim().slice(0, NAME_MAX_LEN);
  return name || 'Player';
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
  const payload = verifySupabaseToken(accessToken);
  socket.authUserId = payload.sub;
  socket.authDisplayName = resolveDisplayName(payload);
  socket.authAvatarUrl = resolveAvatarUrl(payload);
  if (db.isConnected()) {
    await db.upsertUser({
      id: socket.authUserId,
      displayName: socket.authDisplayName,
      avatarUrl: socket.authAvatarUrl,
    });
  }
}

/**
 * Resolve the player name from verified auth or guest input.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} clientName Name sent by the client.
 * @returns {string}
 */
function resolvePlayerName(socket, clientName) {
  if (socket.authUserId && socket.authDisplayName) {
    return socket.authDisplayName;
  }
  return String(clientName || '').trim().slice(0, NAME_MAX_LEN);
}

module.exports = {
  LOG_PREFIX,
  isAuthConfigured,
  verifySupabaseToken,
  resolveDisplayName,
  resolveAvatarUrl,
  attachAuthToSocket,
  resolvePlayerName,
};
