const { scoreOf } = require('../../scoring/scoring');
const { rankedTeams } = require('../../scoring/ranking');

/**
 * Auth user ids for signed-in humans on the winning team.
 *
 * @param {object} room Finished room with winner fields set.
 * @returns {Set<string>}
 */
function getWinningAuthUserIds(room) {
  const winnerIds = new Set();
  if (room.winnerTeamId == null || !room.teams) return winnerIds;
  const winTeam = room.teams.find((team) => team.id === room.winnerTeamId);
  if (!winTeam) return winnerIds;
  winTeam.members.forEach((playerId) => {
    const player = room.players.find((entry) => entry.id === playerId);
    if (player && !player.isBot && player.authUserId) {
      winnerIds.add(player.authUserId);
    }
  });
  return winnerIds;
}

/**
 * Assign winner fields on a finished room from current scores (team mode).
 *
 * @param {object} room Active room with final scores.
 */
function resolveWinners(room) {
  room.winnerPlayerIds = [];
  const ranked = rankedTeams(room);
  const winTeam = ranked[0] ? ranked[0].team : null;
  room.winnerTeamId = winTeam ? winTeam.id : null;
  if (winTeam) {
    const members = winTeam.members
      .map((pid) => room.players.find((p) => p.id === pid))
      .filter(Boolean)
      .sort((a, b) => scoreOf(room, b) - scoreOf(room, a));
    room.winnerId = members[0] ? members[0].id : null;
  }
  room.finished = true;
}

/**
 * Push end-of-game log lines for team mode.
 *
 * @param {object} room Finished room.
 * @param {function} log Log callback.
 */
function announceWinners(room, log) {
  if (!room.teams) return;
  const ranked = rankedTeams(room);
  const winTeam = room.teams.find((t) => t.id === room.winnerTeamId);
  if (winTeam && ranked[0]) {
    log(`Game over! Team ${winTeam.name} wins with ${ranked[0].score} points! 🏆`);
  }
}

module.exports = {
  getWinningAuthUserIds,
  resolveWinners,
  announceWinners,
};
