const {
  PLAYER_COLORS,
  TEAM_COLORS,
  TEAM_NAMES,
  TEAM_PALETTES,
  TEAM_CONFIGS,
} = require('../core/constants');
const { getTeamOfPlayer } = require('./scoring');

function getTeamPalette(teamId) {
  if (teamId == null || teamId < 0 || teamId >= TEAM_PALETTES.length) return null;
  return TEAM_PALETTES[teamId];
}

function getUsedColors(room, excludePlayerId) {
  return new Set(
    room.players
      .filter((p) => p.id !== excludePlayerId)
      .map((p) => p.color)
  );
}

function pickTeamColor(room, teamId, excludePlayerId, avoidColor) {
  const palette = getTeamPalette(teamId);
  if (!palette) return PLAYER_COLORS[0];
  const used = getUsedColors(room, excludePlayerId);
  let candidates = palette.filter((c) => !used.has(c));
  if (avoidColor) {
    const preferred = candidates.filter((c) => c !== avoidColor);
    if (preferred.length) candidates = preferred;
  }
  if (candidates.length) return candidates[0];
  return palette.find((c) => c !== avoidColor) || palette[0];
}

function assignPlayerTeamColor(room, playerId, forceNew) {
  const team = getTeamOfPlayer(room, playerId);
  if (!team) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;
  const palette = getTeamPalette(team.id);
  if (!palette) return;
  if (!forceNew && palette.includes(player.color) && !getUsedColors(room, playerId).has(player.color)) {
    return;
  }
  player.color = pickTeamColor(room, team.id, playerId, forceNew ? player.color : null);
}

function assignAllTeamColors(room) {
  if (!room.teamMode || !room.teams) return;
  room.teams.forEach((team) => {
    team.members.forEach((pid) => assignPlayerTeamColor(room, pid, false));
  });
}

function getAllowedColorsForPlayer(room, playerId) {
  if (!room.teamMode || !room.teams) return PLAYER_COLORS;
  const team = getTeamOfPlayer(room, playerId);
  if (team) return getTeamPalette(team.id) || PLAYER_COLORS;
  const colors = [];
  const seen = new Set();
  room.teams.forEach((t) => {
    getTeamPalette(t.id).forEach((c) => {
      if (!seen.has(c)) {
        seen.add(c);
        colors.push(c);
      }
    });
  });
  return colors.length ? colors : PLAYER_COLORS;
}

function getValidTeamConfigs(playerCount) {
  return TEAM_CONFIGS.filter((c) => c.total === playerCount);
}

function buildTeams(room, numTeams) {
  const teams = [];
  for (let t = 0; t < numTeams; t++) {
    teams.push({
      id: t,
      name: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      members: [],
    });
  }
  room.players.forEach((p, idx) => {
    teams[idx % numTeams].members.push(p.id);
  });
  return teams;
}

module.exports = {
  getTeamPalette,
  getUsedColors,
  pickTeamColor,
  assignPlayerTeamColor,
  assignAllTeamColors,
  getAllowedColorsForPlayer,
  getValidTeamConfigs,
  buildTeams,
};
