/**
 * Mark extra 1s as re-faceable when more than one 1 is rolled.
 *
 * @param {object} room Active room with dice set.
 */
function applyOnesRule(room) {
  const ones = room.dice.map((d, i) => (d === 1 ? i : -1)).filter((i) => i >= 0);
  room.adjustable = ones.length >= 2 ? ones.slice(0, ones.length - 1) : [];
}

module.exports = {
  applyOnesRule,
};
