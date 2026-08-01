/**
 * Mark extra 1s as re-faceable when more than one 1 is rolled.
 *
 * @param {object} room Active room with dice set.
 */
function applyOnesRule(room) {
  const ones = room.dice.map((d, i) => (d === 1 ? i : -1)).filter((i) => i >= 0);
  room.adjustable = ones.length >= 2 ? ones.slice(0, ones.length - 1) : [];
}

/**
 * Re-face an "extra" 1 die to a new value. Returns whether the change was applied.
 * Rejects when the die is not in `room.adjustable`, when any die has already been used
 * for a climb, or when the target value is out of range. On success, the die is
 * consumed from `room.adjustable` so it cannot be re-faced again this turn.
 *
 * @param {object} room Active room with dice set.
 * @param {number} index Index of the die to re-face.
 * @param {number} value Target face value (1–6).
 * @returns {boolean} True when the adjustment was applied.
 */
function adjustDie(room, index, value) {
  if (!Array.isArray(room.dice) || !Array.isArray(room.diceUsed) || !Array.isArray(room.adjustable)) return false;
  if (room.diceUsed.some((u) => u)) return false;
  if (!room.adjustable.includes(index)) return false;
  const face = Number.parseInt(value, 10);
  if (!(face >= 1 && face <= 6)) return false;
  room.dice[index] = face;
  room.adjustable = room.adjustable.filter((i) => i !== index);
  return true;
}

module.exports = {
  applyOnesRule,
  adjustDie,
};
