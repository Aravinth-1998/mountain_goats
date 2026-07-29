const climb = require('./climb');
const winners = require('./winners');
const lobby = require('./lobby');

module.exports = {
  id: 'standard',
  label: 'Standard',
  statKey: 'standard',
  usesTeams: false,
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
