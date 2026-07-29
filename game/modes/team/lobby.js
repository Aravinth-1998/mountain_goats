const {
  getValidTeamConfigs,
  buildTeams,
  assignAllTeamColors,
  assignPlayerTeamColor,
} = require('../../teams/lobby');
const { TEAM_PALETTES } = require('../../core/constants');

/**
 * Clean team membership before start; downgrade to standard if fewer than 2 teams remain.
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 * @param {function} setRoomMode Mode switcher from registry.
 */
function syncLobbyForStart(room, log = () => {}, setRoomMode) {
  if (!room.teams) return;
  const allIds = new Set(room.players.map((p) => p.id));
  room.teams.forEach((t) => {
    t.members = t.members.filter((id) => allIds.has(id));
  });
  const assigned = new Set(room.teams.flatMap((t) => t.members));
  room.players.forEach((p) => {
    if (!assigned.has(p.id)) {
      const smallest = room.teams.reduce((a, b) => (a.members.length <= b.members.length ? a : b));
      smallest.members.push(p.id);
      assignPlayerTeamColor(room, p.id, false);
    }
  });
  room.teams = room.teams.filter((t) => t.members.length > 0);
  if (room.teams.length < 2 && typeof setRoomMode === 'function') {
    setRoomMode(room, 'standard', () => {});
    log('Team mode disabled (not enough teams).');
  }
}

/**
 * Whether the room can start in team mode.
 *
 * @param {object} room Active room.
 * @returns {{ ok: boolean, reason?: string }}
 */
function canStart(room) {
  if (room.players.length < 2) {
    return { ok: false, reason: 'Need at least 2 players.' };
  }
  if (!room.teams || room.teams.length < 2) {
    return { ok: true };
  }
  const sizes = room.teams.map((t) => t.members.length);
  if (sizes.some((s) => s !== sizes[0])) {
    return { ok: false, reason: 'Cannot start: teams must have equal number of players.' };
  }
  return { ok: true };
}

/**
 * Interleave players so turns alternate between teams.
 *
 * @param {object} room Active room.
 */
function prepareStart(room) {
  if (!room.teams || room.teams.length < 2) {
    for (let i = room.players.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
    }
    return;
  }
  const teamsCopy = [...room.teams];
  for (let i = teamsCopy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [teamsCopy[i], teamsCopy[j]] = [teamsCopy[j], teamsCopy[i]];
  }
  const teamMembers = teamsCopy.map((t) => {
    const members = t.members
      .map((pid) => room.players.find((p) => p.id === pid))
      .filter(Boolean);
    for (let i = members.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [members[i], members[j]] = [members[j], members[i]];
    }
    return members;
  });
  const interleaved = [];
  const maxLen = Math.max(...teamMembers.map((m) => m.length));
  for (let slot = 0; slot < maxLen; slot++) {
    for (let t = 0; t < teamMembers.length; t++) {
      if (slot < teamMembers[t].length) {
        interleaved.push(teamMembers[t][slot]);
      }
    }
  }
  room.players = interleaved;
  room.teams = teamsCopy;
}

/**
 * Called when team mode becomes active: build teams and assign colors.
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 */
function onSetMode(room, log = () => {}) {
  const configs = getValidTeamConfigs(room.players.length);
  if (configs.length > 0) {
    room.teams = buildTeams(room, configs[0].teams);
    assignAllTeamColors(room);
    log(`Team mode enabled! (${configs[0].teams} teams of ${configs[0].perTeam})`);
  } else {
    room.teams = buildTeams(room, 2);
    assignAllTeamColors(room);
    log('Team mode enabled! Teams may be uneven.');
  }
}

/**
 * Called when leaving team mode.
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 */
function onClearMode(room, log = () => {}) {
  room.teams = null;
  room.winnerTeamId = null;
  log('Team mode disabled.');
}

/**
 * Extra fields for publicState.
 *
 * @param {object} room Active room.
 * @returns {object}
 */
function extraPublicState(room) {
  return { teamPalettes: TEAM_PALETTES };
}

/**
 * Opening log line when the match starts.
 *
 * @param {object} room Active room.
 * @returns {string}
 */
function startLogMessage(room) {
  if (!room.teams) return 'The climb begins! 🐐';
  const teamNames = room.teams.map((t) => {
    const names = t.members.map((id) => {
      const p = room.players.find((pl) => pl.id === id);
      return p ? p.name : '?';
    }).join(', ');
    return `Team ${t.name}: ${names}`;
  }).join(' | ');
  return `The climb begins! 🐐 [Teams: ${teamNames}]`;
}

/**
 * Auto-assign a newly joined player to the smallest team.
 *
 * @param {object} room Active room.
 * @param {object} player Joined player.
 */
function onPlayerJoined(room, player) {
  if (!room.teams || !room.teams.length) return;
  const smallest = room.teams.reduce((a, b) => (a.members.length <= b.members.length ? a : b));
  smallest.members.push(player.id);
  assignPlayerTeamColor(room, player.id, false);
}

module.exports = {
  syncLobbyForStart,
  canStart,
  prepareStart,
  onSetMode,
  onClearMode,
  extraPublicState,
  startLogMessage,
  onPlayerJoined,
};
