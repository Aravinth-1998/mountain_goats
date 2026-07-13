const { scoreOf } = require('../scoring/scoring');
const { rankedPlayers, rankedTeams, winnerSlotCount } = require('../scoring/ranking');

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
 * Auth user ids for signed-in humans on the winning side.
 *
 * @param {object} room Finished room with winner fields set.
 * @returns {Set<string>}
 */
function getWinningAuthUserIds(room) {
  const winnerIds = new Set();
  if (room.teamMode && room.winnerTeamId != null && room.teams) {
    const winTeam = room.teams.find((team) => team.id === room.winnerTeamId);
    if (winTeam) {
      winTeam.members.forEach((playerId) => {
        const player = room.players.find((entry) => entry.id === playerId);
        if (player && !player.isBot && player.authUserId) {
          winnerIds.add(player.authUserId);
        }
      });
    }
  } else {
    const winnerPlayerIds = room.winnerPlayerIds && room.winnerPlayerIds.length
      ? room.winnerPlayerIds
      : (room.winnerId ? [room.winnerId] : []);
    winnerPlayerIds.forEach((playerId) => {
      const player = room.players.find((entry) => entry.id === playerId);
      if (player && !player.isBot && player.authUserId) {
        winnerIds.add(player.authUserId);
      }
    });
  }
  return winnerIds;
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
  const teamMode = !!room.teamMode;
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
 * Assign winner fields on a finished room from current scores.
 *
 * @param {object} room Active room with final scores.
 */
function resolveWinners(room) {
  if (room.teamMode && room.teams) {
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
  } else {
    const ranked = rankedPlayers(room);
    const slots = winnerSlotCount(room);
    room.winnerPlayerIds = ranked.slice(0, slots).map((entry) => entry.p.id);
    room.winnerId = ranked[0] ? ranked[0].p.id : null;
  }
  room.finished = true;
}

module.exports = {
  getSignedInParticipants,
  getWinningAuthUserIds,
  buildMatchStatUpdates,
  resolveWinners,
};
