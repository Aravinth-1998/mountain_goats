const { rankedPlayers, winnerSlotCount } = require('../../scoring/ranking');

/**
 * Auth user ids for signed-in humans among standard-mode winners.
 *
 * @param {object} room Finished room with winner fields set.
 * @returns {Set<string>}
 */
function getWinningAuthUserIds(room) {
  const winnerIds = new Set();
  const winnerPlayerIds = room.winnerPlayerIds && room.winnerPlayerIds.length
    ? room.winnerPlayerIds
    : (room.winnerId ? [room.winnerId] : []);
  winnerPlayerIds.forEach((playerId) => {
    const player = room.players.find((entry) => entry.id === playerId);
    if (player && !player.isBot && player.authUserId) {
      winnerIds.add(player.authUserId);
    }
  });
  return winnerIds;
}

/**
 * Assign winner fields on a finished room from current scores (standard mode).
 *
 * @param {object} room Active room with final scores.
 */
function resolveWinners(room) {
  const ranked = rankedPlayers(room);
  const slots = winnerSlotCount(room);
  room.winnerPlayerIds = ranked.slice(0, slots).map((entry) => entry.p.id);
  room.winnerId = ranked[0] ? ranked[0].p.id : null;
  room.finished = true;
}

/**
 * Format winner names for the end-of-game log.
 *
 * @param {string[]} names Winner display names.
 * @returns {string}
 */
function formatWinnerNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/**
 * Push end-of-game log lines for standard mode.
 *
 * @param {object} room Finished room.
 * @param {function} log Log callback.
 */
function announceWinners(room, log) {
  const ranked = rankedPlayers(room);
  const slots = winnerSlotCount(room);
  const winners = ranked.slice(0, slots).map((entry) => entry.p).filter(Boolean);
  if (!winners.length) return;
  if (winners.length === 1) {
    log(`Game over! ${winners[0].name} wins with ${ranked[0].score} points! 🏆`);
    return;
  }
  log(`Game over! ${formatWinnerNames(winners.map((p) => p.name))} win! 🏆`);
}

module.exports = {
  getWinningAuthUserIds,
  resolveWinners,
  announceWinners,
};
