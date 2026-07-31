const { scoreOf, topsOf, highestTopValue } = require('./scoring');
const {
  teamScoreOf,
  teamTopsOf,
  teamHighestTopValue,
} = require('../teams/scoring');

function rankedPlayers(room) {
  return room.players
    .map((p) => ({
      p,
      score: scoreOf(room, p),
      tops: topsOf(room, p),
      highTop: highestTopValue(room, p),
    }))
    .sort((a, b) => b.score - a.score || b.tops - a.tops || b.highTop - a.highTop);
}

function rankedTeams(room) {
  if (!room.teamMode || !room.teams) return [];
  return room.teams
    .map((t) => ({
      team: t,
      score: teamScoreOf(room, t),
      tops: teamTopsOf(room, t),
      highTop: teamHighestTopValue(room, t),
    }))
    .sort((a, b) => b.score - a.score || b.tops - a.tops || b.highTop - a.highTop);
}

/**
 * Number of individual winners in standard mode:
 * 1 for 2-4 players, 2 for 5-7, 3 for 8-10.
 *
 * @param {object} room Active or finished room.
 * @returns {number}
 */
function winnerSlotCount(room) {
  const playerCount = room.players.filter((p) => p.connected).length || room.players.length;
  if (playerCount >= 8) return 3;
  if (playerCount >= 5) return 2;
  return 1;
}

module.exports = {
  rankedPlayers,
  rankedTeams,
  winnerSlotCount,
};
