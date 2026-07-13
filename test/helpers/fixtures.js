const { MOUNTAIN_DEFS, TEAM_NAMES, TEAM_COLORS } = require('../../game/core/constants');
const { buildMountains } = require('../../game/core/mountains');

function makePlayer({ id, name, collected, pos, bonus, authUserId, isBot } = {}) {
  return {
    id: id || 'p0',
    name: name || 'Player',
    collected: collected || MOUNTAIN_DEFS.map(() => 0),
    pos: pos || MOUNTAIN_DEFS.map(() => 0),
    bonus: bonus || [],
    connected: true,
    isBot: !!isBot,
    authUserId: authUserId || null,
  };
}

function makeTeams(players, numTeams = 2) {
  const teams = [];
  for (let t = 0; t < numTeams; t++) {
    teams.push({
      id: t,
      name: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      members: [],
    });
  }
  players.forEach((p, idx) => {
    teams[idx % numTeams].members.push(p.id);
  });
  return teams;
}

function makeRoom({ playerCount = 2, teamMode = false, mountains: customMountains, bonusTokens } = {}) {
  const mountains = customMountains || buildMountains(playerCount);
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push(makePlayer({ id: `p${i}`, name: `Player ${i}` }));
  }
  return {
    players,
    mountains,
    bonusTokens: bonusTokens !== undefined ? bonusTokens : [15, 12, 9, 6],
    teamMode,
    teams: teamMode ? makeTeams(players, 2) : null,
    lastRound: false,
    endReason: null,
    winnerId: null,
    winnerPlayerIds: [],
    winnerTeamId: null,
    dice: null,
    diceUsed: [],
    adjustable: [],
  };
}

module.exports = {
  makePlayer,
  makeRoom,
  makeTeams,
};
