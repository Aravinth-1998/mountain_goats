const { takeToken } = require('../../actions/climb-helpers');
const { getTeamOfPlayer, areTeammates, teamHasSummit } = require('../../teams/scoring');

/**
 * Team-mode climb: teammates co-occupy summit; opponents get team wipeout.
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
    let bumped = false;
    let bumpedTeamName = '';
    room.players.forEach((o) => {
      if (o.id !== player.id && o.pos[i] >= m.height) {
        if (areTeammates(room, player.id, o.id)) {
          // Teammate on summit — they stay (co-occupy).
        } else {
          o.pos[i] = 0;
          const oTeam = getTeamOfPlayer(room, o.id);
          bumpedTeamName = oTeam ? oTeam.name : '';
          bumped = true;
          log(`${o.name}'s goat was wiped off the top of Mountain ${m.value}! (Team Wipeout)`);
        }
      }
    });
    if (bumped && bumpedTeamName) {
      log(`Team ${bumpedTeamName} lost all goats on Mountain ${m.value} summit!`);
    }
    if (m.chips > 0) {
      takeToken(room, player, i, log);
      const teammateAlreadyOnTop = teamHasSummit(room, player, i);
      if (teammateAlreadyOnTop) {
        log(`${player.name} joined teammate on Mountain ${m.value} summit (+${m.value}).`);
      } else {
        log(`${player.name} reached the top of Mountain ${m.value} (+${m.value}).`);
      }
    } else {
      log(`${player.name} reached the top of Mountain ${m.value} (no tokens left).`);
    }
  }
}

module.exports = {
  applyClimb,
};
