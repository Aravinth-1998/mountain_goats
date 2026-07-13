const { areTeammates } = require('../teams/scoring');

/**
 * Score a single possible group (indices + target mountain) for the bot.
 *
 * @param {object} room Active room.
 * @param {object} bot Bot player.
 * @param {number[]} indices Dice indices in the group.
 * @param {number} mi Mountain index.
 * @returns {number}
 */
function scoreGroup(room, bot, indices, mi) {
  const m = room.mountains[mi];
  const pos = bot.pos[mi];
  const atTop = pos >= m.height;
  const stepsLeft = m.height - pos;

  const currentSets = bot.collected.reduce((mn, c) => Math.min(mn, c), Infinity);
  const newCollected = bot.collected.map((c, i) => (i === mi ? c + 1 : c));
  const newSets = newCollected.reduce((mn, c) => Math.min(mn, c), Infinity);
  const bonusValue = newSets > currentSets && room.bonusTokens.length > 0
    ? room.bonusTokens[0]
    : 0;

  const oppsOnTop = room.players.filter(
    (o) => o.id !== bot.id && o.pos[mi] >= m.height && !areTeammates(room, bot.id, o.id)
  ).length;

  let value;

  if (m.chips <= 0) {
    if (!atTop && stepsLeft === 1 && oppsOnTop > 0) {
      value = 2 * oppsOnTop;
    } else {
      return -Infinity;
    }
  } else if (atTop) {
    value = m.value + bonusValue;
    value += Math.max(0, 3 - m.chips);
  } else if (stepsLeft === 1) {
    value = m.value + 4 + bonusValue + oppsOnTop * 3;
    value += Math.max(0, 4 - m.chips) * 1.5;
  } else {
    const progressFactor = 1 / stepsLeft;
    value = m.value * 0.4 * progressFactor;
    if (m.chips <= 3) value += 1.5;
  }

  value -= (indices.length - 1) * 0.8;

  return value;
}

module.exports = {
  scoreGroup,
};
