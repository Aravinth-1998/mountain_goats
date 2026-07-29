const { getModeForRoom } = require('../modes');

/**
 * Signed-in human players in a room.
 *
 * @param {object} room Active room.
 * @returns {object[]}
 */
function getSignedInParticipants(room) {
  return room.players.filter((player) => !player.isBot && player.authUserId);
}

/**
 * Auth user ids for signed-in humans on the winning side (mode-dispatched).
 *
 * @param {object} room Finished room with winner fields set.
 * @returns {Set<string>}
 */
function getWinningAuthUserIds(room) {
  return getModeForRoom(room).getWinningAuthUserIds(room);
}

/**
 * Build per-user win/loss updates for completed games.
 *
 * @param {object} room Finished room with winner fields set.
 * @returns {{ userId: string, won: boolean, teamMode: boolean }[]}
 */
function buildMatchStatUpdates(room) {
  const winners = getWinningAuthUserIds(room);
  const seenUserIds = new Set();
  const mode = getModeForRoom(room);
  const teamMode = mode.statKey === 'team';
  const updates = [];
  getSignedInParticipants(room).forEach((player) => {
    if (seenUserIds.has(player.authUserId)) return;
    seenUserIds.add(player.authUserId);
    updates.push({
      userId: player.authUserId,
      won: winners.has(player.authUserId),
      teamMode,
    });
  });
  return updates;
}

/**
 * Assign winner fields on a finished room from current scores (mode-dispatched).
 *
 * @param {object} room Active room with final scores.
 */
function resolveWinners(room) {
  getModeForRoom(room).resolveWinners(room);
}

/**
 * Push end-of-game log lines for the active mode.
 *
 * @param {object} room Finished room.
 * @param {function} log Log callback.
 */
function announceWinners(room, log) {
  getModeForRoom(room).announceWinners(room, log);
}

module.exports = {
  getSignedInParticipants,
  getWinningAuthUserIds,
  buildMatchStatUpdates,
  resolveWinners,
  announceWinners,
};
