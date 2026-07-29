/**
 * Sync lobby state before start (standard has nothing to clean).
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 * @param {function} [setRoomMode] Mode switcher (unused in standard).
 */
function syncLobbyForStart(room, log = () => {}, setRoomMode) {
  // no-op
}

/**
 * Whether the room can start in standard mode.
 *
 * @param {object} room Active room.
 * @returns {{ ok: boolean, reason?: string }}
 */
function canStart(room) {
  if (room.players.length < 2) {
    return { ok: false, reason: 'Need at least 2 players.' };
  }
  return { ok: true };
}

/**
 * Shuffle player order so the host does not always go first.
 *
 * @param {object} room Active room.
 */
function prepareStart(room) {
  for (let i = room.players.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
  }
}

/**
 * Called when this mode becomes active on the room.
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 */
function onSetMode(room, log = () => {}) {
  room.teams = null;
  room.winnerTeamId = null;
}

/**
 * Called when leaving this mode.
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 */
function onClearMode(room, log = () => {}) {
  // no-op
}

/**
 * Extra fields for publicState.
 *
 * @param {object} room Active room.
 * @returns {object}
 */
function extraPublicState(room) {
  return { teamPalettes: null };
}

/**
 * Opening log line when the match starts.
 *
 * @param {object} room Active room.
 * @returns {string}
 */
function startLogMessage(room) {
  return 'The climb begins! 🐐';
}

/**
 * Assign a newly joined player for this mode (standard: nothing).
 *
 * @param {object} room Active room.
 * @param {object} player Joined player.
 */
function onPlayerJoined(room, player) {
  // no-op
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
