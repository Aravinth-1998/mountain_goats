const { takeToken } = require('../../actions/climb-helpers');

/**
 * Standard-mode climb: single-occupancy summit with classic bump.
 *
 * @param {object} room Active room.
 * @param {object} player Climbing player.
 * @param {number} i Mountain index.
 * @param {function} [log] Log callback.
 */
function applyClimb(room, player, i, log = () => {}) {
  const m = room.mountains[i];
  if (player.pos[i] >= m.height) {
    if (m.chips > 0) {
      takeToken(room, player, i, log);
      log(`${player.name} harvested a ${m.value}p token from Mountain ${m.value}.`);
    }
    return;
  }
  player.pos[i] += 1;
  if (player.pos[i] >= m.height) {
    room.players.forEach((o) => {
      if (o.id !== player.id && o.pos[i] >= m.height) {
        o.pos[i] = 0;
        log(`${o.name}'s goat was bumped off the top of Mountain ${m.value}!`);
      }
    });
    if (m.chips > 0) {
      takeToken(room, player, i, log);
      log(`${player.name} reached the top of Mountain ${m.value} (+${m.value}).`);
    } else {
      log(`${player.name} reached the top of Mountain ${m.value} (no tokens left).`);
    }
  }
}

module.exports = {
  applyClimb,
};
