const { setsOf } = require('../scoring/scoring');
const { emptyMountainCount } = require('../core/mountains');

/**
 * Trigger final round when all bonus tokens are gone or 3 mountains are empty.
 *
 * @param {object} room Active room.
 * @param {function} [log] Log callback.
 */
function checkEndgameTrigger(room, log = () => {}) {
  if (room.lastRound) return;
  const allBonus = room.bonusTokens.length === 0;
  if (allBonus || emptyMountainCount(room) >= 3) {
    room.lastRound = true;
    room.endReason = allBonus ? 'bonus' : 'empty';
    const reason = allBonus ? 'all Bonus Tokens claimed' : '3 mountains emptied';
    log(`Final round! (${reason}) - everyone gets equal turns. 🔔`);
  }
}

/**
 * Award bonus tokens for newly completed sets.
 *
 * @param {object} room Active room.
 * @param {object} player Player who may have completed sets.
 * @param {function} [log] Log callback.
 */
function awardBonus(room, player, log = () => {}) {
  const sets = Math.max(0, setsOf(player));
  while (player.bonus.length < sets && room.bonusTokens.length > 0) {
    const v = room.bonusTokens.shift();
    player.bonus.push(v);
    log(`${player.name} completed a full set and claimed the ${v}p Bonus Token! ✨`);
  }
}

/**
 * Take one point token from a mountain for the player.
 *
 * @param {object} room Active room.
 * @param {object} player Receiving player.
 * @param {number} i Mountain index.
 * @param {function} [log] Log callback.
 */
function takeToken(room, player, i, log = () => {}) {
  const m = room.mountains[i];
  if (m.chips <= 0) return;
  m.chips -= 1;
  player.collected[i] += 1;
  awardBonus(room, player, log);
  checkEndgameTrigger(room, log);
}

module.exports = {
  checkEndgameTrigger,
  awardBonus,
  takeToken,
};
