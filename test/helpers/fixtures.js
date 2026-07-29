const { MOUNTAIN_DEFS, TEAM_NAMES, TEAM_COLORS } = require('../../game/core/constants');
const { buildMountains } = require('../../game/core/mountains');
const { syncModeFields } = require('../../game/modes');

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

function makeRoom({ playerCount = 2, teamMode = false, modeId, mountains: customMountains, bonusTokens } = {}) {
  const mountains = customMountains || buildMountains(playerCount);
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push(makePlayer({ id: `p${i}`, name: `Player ${i}` }));
  }
  const resolvedModeId = modeId || (teamMode ? 'team' : 'standard');
  const room = {
    players,
    mountains,
    bonusTokens: bonusTokens !== undefined ? bonusTokens : [15, 12, 9, 6],
    teams: resolvedModeId === 'team' ? makeTeams(players, 2) : null,
    lastRound: false,
    endReason: null,
    winnerId: null,
    winnerPlayerIds: [],
    winnerTeamId: null,
    dice: null,
    diceUsed: [],
    adjustable: [],
  };
  syncModeFields(room, resolvedModeId);
  return room;
}

module.exports = {
  makePlayer,
  makeRoom,
  makeTeams,
};
