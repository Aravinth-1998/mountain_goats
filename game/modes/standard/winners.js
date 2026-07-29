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
 * Push end-of-game log lines for standard mode.
 *
 * @param {object} room Finished room.
 * @param {function} log Log callback.
 */
function announceWinners(room, log) {
  const ranked = rankedPlayers(room);
  const slots = winnerSlotCount(room);
  const winner = ranked[0] ? ranked[0].p : null;
  if (!winner) return;
  if (slots === 2 && ranked[1]) {
    log(`Game over! ${winner.name} and ${ranked[1].p.name} win! 🏆`);
  } else {
    log(`Game over! ${winner.name} wins with ${ranked[0].score} points! 🏆`);
  }
}

module.exports = {
  getWinningAuthUserIds,
  resolveWinners,
  announceWinners,
};
