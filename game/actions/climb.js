const {
  checkEndgameTrigger,
  awardBonus,
  takeToken,
} = require('./climb-helpers');
const { getModeForRoom } = require('../modes');

/**
 * Dispatch climb rules to the room's active game mode.
 *
 * @param {object} room Active room.
 * @param {object} player Climbing player.
 * @param {number} i Mountain index.
 * @param {function} [log] Log callback.
 */
function applyClimb(room, player, i, log = () => {}) {
  getModeForRoom(room).applyClimb(room, player, i, log);
}

module.exports = {
  checkEndgameTrigger,
  awardBonus,
  takeToken,
  applyClimb,
};
