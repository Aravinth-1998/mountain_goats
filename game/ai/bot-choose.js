const { scoreGroup } = require('./bot-heuristics');

/**
 * Enumerate all subsets of unused dice, evaluate each valid group, pick the best.
 *
 * @param {object} room Active room.
 * @param {object} bot Current bot player.
 * @param {number[]} [diceOverride] Dice faces to use instead of room.dice.
 * @param {boolean[]} [diceUsedOverride] Used flags instead of room.diceUsed.
 * @returns {{ indices: number[], mountainIndex: number, score: number } | null}
 */
function botChooseGroup(room, bot, diceOverride, diceUsedOverride) {
  const dice = diceOverride || room.dice;
  const diceUsed = diceUsedOverride || room.diceUsed;
  const unused = dice.map((_, i) => i).filter((i) => !diceUsed[i]);
  const n = unused.length;
  let best = null;

  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0;
    const indices = [];
    for (let b = 0; b < n; b++) {
      if (mask & (1 << b)) {
        sum += dice[unused[b]];
        indices.push(unused[b]);
      }
    }
    if (sum < 5 || sum > 10) continue;
    const mi = room.mountains.findIndex((m) => m.value === sum);
    if (mi < 0) continue;

    const score = scoreGroup(room, bot, indices, mi);
    if (!best || score > best.score) {
      best = { indices, mountainIndex: mi, score };
    }
  }

  return best && best.score > -Infinity ? best : null;
}

/**
 * Score a full greedy bot turn using the given dice faces (simulation only).
 *
 * @param {object} room Active room.
 * @param {object} bot Current bot player.
 * @param {number[]} dice Dice faces to simulate.
 * @returns {number} Sum of chosen group scores for the turn.
 */
function simulateGreedyBotTurn(room, bot, dice) {
  const simUsed = dice.map(() => false);
  let totalScore = 0;

  while (true) {
    const group = botChooseGroup(room, bot, dice, simUsed);
    if (!group) break;
    totalScore += group.score;
    group.indices.forEach((idx) => {
      simUsed[idx] = true;
    });
  }

  return totalScore;
}

/**
 * Re-face all extra 1s before the bot plays any dice groups.
 *
 * @param {object} room Active room.
 * @param {object} bot Current bot player.
 * @param {string} label Log label for the acting player.
 * @param {(msg: string) => void} [log] Optional log callback.
 */
function botOptimizeAdjustableDice(room, bot, label, log = () => {}) {
  if (!room.adjustable.length) return;

  const adjustable = room.adjustable.slice();
  const originalFaces = adjustable.map((index) => room.dice[index]);
  const comboCount = Math.pow(6, adjustable.length);
  const simDice = room.dice.slice();
  let bestScore = -Infinity;
  let bestFaces = originalFaces.slice();

  for (let combo = 0; combo < comboCount; combo++) {
    let remainder = combo;
    for (let j = 0; j < adjustable.length; j++) {
      simDice[adjustable[j]] = (remainder % 6) + 1;
      remainder = Math.floor(remainder / 6);
    }
    const score = simulateGreedyBotTurn(room, bot, simDice);
    if (score > bestScore) {
      bestScore = score;
      bestFaces = adjustable.map((index) => simDice[index]);
    }
  }

  let changed = false;
  adjustable.forEach((index, j) => {
    if (room.dice[index] !== bestFaces[j]) changed = true;
    room.dice[index] = bestFaces[j];
  });
  room.adjustable = [];

  if (changed) {
    log(`${label} re-faced dice to ${bestFaces.join(', ')}.`);
  }
}

module.exports = {
  botChooseGroup,
  simulateGreedyBotTurn,
  botOptimizeAdjustableDice,
};
