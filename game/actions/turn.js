/**
 * Pure turn-state transitions. Timer scheduling and bot dispatch are the
 * caller's responsibility so this module stays free of I/O.
 */

/**
 * Advance the current turn's per-turn state and pick the next seat.
 * Increments the finishing player's `turns` counter, clears roll state
 * (`rolled`, `dice`, `diceUsed`, `adjustable`), and moves `currentIndex`
 * forward by one seat, wrapping at the end of the roster.
 *
 * Every seat is a valid target — a disconnected non-bot player is still
 * "next" and the caller substitutes a bot for that turn downstream.
 *
 * @param {object} room Active room state.
 * @returns {void}
 */
function advanceTurnState(room) {
  if (!Array.isArray(room.players) || room.players.length === 0) return;

  const finishing = room.players[room.currentIndex];
  if (finishing) finishing.turns = (finishing.turns || 0) + 1;

  room.rolled = false;
  room.dice = null;
  room.diceUsed = [];
  room.adjustable = [];
  room.currentIndex = (room.currentIndex + 1) % room.players.length;
}

/**
 * True when the last-round condition is met: every connected player has
 * taken the same number of turns. Used by `advanceTurnState` callers to
 * decide whether to call `endGame(room)` before scheduling the next turn.
 *
 * @param {object} room Active room state.
 * @returns {boolean}
 */
function isLastRoundComplete(room) {
  if (!room.lastRound || room.finished) return false;
  const counts = room.players.filter((p) => p.connected).map((p) => p.turns || 0);
  if (!counts.length) return false;
  return Math.max(...counts) === Math.min(...counts);
}

module.exports = {
  advanceTurnState,
  isLastRoundComplete,
};
