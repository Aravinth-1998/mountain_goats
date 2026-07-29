const climb = require('./climb');
const winners = require('./winners');
const lobby = require('./lobby');

/**
 * Standard rules played with teams (not a base mode of its own).
 * Future base modes can add their own *Team variants the same way.
 */
module.exports = {
  id: 'standardTeam',
  label: 'Team',
  /** Stats/history bucket; keep "team" for existing DB columns. */
  statKey: 'team',
  usesTeams: true,
  applyClimb: climb.applyClimb,
  resolveWinners: winners.resolveWinners,
  getWinningAuthUserIds: winners.getWinningAuthUserIds,
  announceWinners: winners.announceWinners,
  syncLobbyForStart: lobby.syncLobbyForStart,
  canStart: lobby.canStart,
  prepareStart: lobby.prepareStart,
  onSetMode: lobby.onSetMode,
  onClearMode: lobby.onClearMode,
  extraPublicState: lobby.extraPublicState,
  startLogMessage: lobby.startLogMessage,
  onPlayerJoined: lobby.onPlayerJoined,
};
