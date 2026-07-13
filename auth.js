/**
 * Supabase JWT verification for Socket.IO authentication.
 */

const jwt = require('jsonwebtoken');
const notifications = require('./notifications');
const { NEW_USER } = require('./notifications/events');

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
 * Persist verified profile fields to the database.
 *
 * @param {object} db Database module.
 * @param {object} profile Profile fields.
 * @param {string} profile.userId Supabase auth user id.
 * @param {string} profile.googleName Google display name.
 * @param {string|null} profile.avatarUrl Avatar URL.
 * @param {string|null} profile.gamingName Gaming name from metadata.
 * @param {string|null} [profile.email] Google account email.
 * @returns {Promise<{ userId: string, googleName: string, gamingName: string|null, avatarUrl: string|null }>}
 */
async function persistAuthUserProfile(db, profile) {
  const userId = profile.userId;
  let googleName = profile.googleName;
  const avatarUrl = profile.avatarUrl;
  let gamingName = profile.gamingName;
  const email = profile.email || null;

  if (!(await db.ensureConnected())) {
    console.warn(`${LOG_PREFIX} persistAuthUserProfile skipped: database not connected`);
    return { userId, googleName, gamingName, avatarUrl };
  }

  const { isNew, memberNumber } = await db.upsertAuthUser({
    id: userId,
    googleName,
    avatarUrl,
  });

  if (!gamingName) {
    gamingName = await db.getGamingName(userId);
  } else {
    await db.saveGamingName(userId, gamingName);
  }

  if (isNew) {
    notifications.sendAlert(NEW_USER, {
      userId,
      googleName,
      email,
      gamingName: gamingName || null,
      memberNumber,
    });
  }

  return { userId, googleName, gamingName, avatarUrl };
}

/**
 * Persist verified auth profile fields to the database.
 *
 * @param {string} accessToken Supabase access token.
 * @param {object} db Database module.
 * @returns {Promise<{ userId: string, googleName: string, gamingName: string|null, avatarUrl: string|null }>}
 */
async function syncAuthUser(accessToken, db) {
  const payload = await verifyAccessToken(accessToken);
  const userId = payload.sub;
  const googleName = resolveGoogleName(payload);
  const avatarUrl = resolveAvatarUrl(payload);
  const gamingName = resolveGamingNameFromPayload(payload);

  return persistAuthUserProfile(db, {
    userId,
    googleName,
    avatarUrl,
    gamingName,
    email: payload.email || null,
  });
}

/**
 * Persist auth profile using socket fields when JWT was already verified.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} accessToken Supabase access token fallback.
 * @param {object} db Database module.
 * @returns {Promise<{ userId: string, googleName: string, gamingName: string|null, avatarUrl: string|null }>}
 */
async function syncAuthUserFromSocket(socket, accessToken, db) {
  if (socket.authUserId) {
    return persistAuthUserProfile(db, {
      userId: socket.authUserId,
      googleName: socket.authGoogleName || 'Player',
      avatarUrl: socket.authAvatarUrl || null,
      gamingName: socket.authGamingName || null,
      email: socket.authEmail || null,
    });
  }

  if (!accessToken) {
    throw new Error('Missing access token');
  }

  const payload = await verifyAccessToken(accessToken);
  socket.authUserId = payload.sub;
  socket.authGoogleName = resolveGoogleName(payload);
  socket.authGamingName = resolveGamingNameFromPayload(payload);
  socket.authAvatarUrl = resolveAvatarUrl(payload);
  socket.authEmail = payload.email || null;

  return persistAuthUserProfile(db, {
    userId: socket.authUserId,
    googleName: socket.authGoogleName,
    avatarUrl: socket.authAvatarUrl,
    gamingName: socket.authGamingName,
    email: socket.authEmail,
  });
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
  const profile = await syncAuthUser(accessToken, db);
  socket.authUserId = profile.userId;
  socket.authGoogleName = profile.googleName;
  socket.authGamingName = profile.gamingName;
  socket.authAvatarUrl = profile.avatarUrl;
}

/**
 * Attach verified auth fields to a socket from JWT only (no database sync).
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} accessToken Supabase access token.
 * @returns {Promise<void>}
 */
async function attachAuthToSocketLight(socket, accessToken) {
  const payload = await verifyAccessToken(accessToken);
  socket.authUserId = payload.sub;
  socket.authGoogleName = resolveGoogleName(payload);
  socket.authGamingName = resolveGamingNameFromPayload(payload);
  socket.authAvatarUrl = resolveAvatarUrl(payload);
  socket.authEmail = payload.email || null;
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
  verifyAccessToken,
  resolveGoogleName,
  resolveGamingNameFromPayload,
  resolveAvatarUrl,
  attachAuthToSocket,
  attachAuthToSocketLight,
  syncAuthUser,
  syncAuthUserFromSocket,
  resolvePlayerName,
};
