const { resetForNewGame } = require('../../game/core/state');
const { makeRoom } = require('./fixtures');

/**
 * Create a room ready for in-memory game-flow integration tests.
 *
 * @param {object} [opts] Room options passed to makeRoom.
 * @returns {object} Started room with reset board state.
 */
function makeStartedRoom(opts = {}) {
  const room = makeRoom(opts);
  resetForNewGame(room);
  room.started = true;
  room.startedAt = Date.now();
  return room;
}

/**
 * No-op log callback for climb and endgame actions.
 *
 * @returns {() => void}
 */
function noopLog() {
  return () => {};
}

/**
 * Collect log messages from climb and endgame actions.
 *
 * @returns {{ log: (msg: string) => void, messages: string[] }}
 */
function collectLog() {
  const messages = [];
  return {
    log: (msg) => messages.push(msg),
    messages,
  };
}

module.exports = {
  makeStartedRoom,
  noopLog,
  collectLog,
};
