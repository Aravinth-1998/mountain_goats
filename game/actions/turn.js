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
 * True when the last-round condition is met: every seat has taken the same
 * number of turns. Used by `advanceTurnState` callers to decide whether to
 * call `endGame(room)` before scheduling the next turn.
 *
 * Every player counts — connected or not. A disconnected player still has a
 * bot playing for them, and their `turns` counter still increments each turn.
 * Filtering the disconnected out would silently make `[6, 5, 5, 5]` look
 * balanced (because the 6 belongs to the disconnected seat) and end the game
 * one turn short for everyone else — the exact bug the game shipped with
 * before this check was written by seat count rather than by connection.
 *
 * @param {object} room Active room state.
 * @returns {boolean}
 */
function isLastRoundComplete(room) {
  if (!room.lastRound || room.finished) return false;
  if (!room.players || !room.players.length) return false;
  const counts = room.players.map((p) => p.turns || 0);
  return Math.max(...counts) === Math.min(...counts);
}

module.exports = {
  advanceTurnState,
  isLastRoundComplete,
};
