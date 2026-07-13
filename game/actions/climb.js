const { setsOf } = require('../scoring/scoring');
const { emptyMountainCount } = require('../core/mountains');
const { getTeamOfPlayer, areTeammates, teamHasSummit } = require('../teams/scoring');

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

function awardBonus(room, player, log = () => {}) {
  const sets = Math.max(0, setsOf(player));
  while (player.bonus.length < sets && room.bonusTokens.length > 0) {
    const v = room.bonusTokens.shift();
    player.bonus.push(v);
    log(`${player.name} completed a full set and claimed the ${v}p Bonus Token! ✨`);
  }
}

function takeToken(room, player, i, log = () => {}) {
  const m = room.mountains[i];
  if (m.chips <= 0) return;
  m.chips -= 1;
  player.collected[i] += 1;
  awardBonus(room, player, log);
  checkEndgameTrigger(room, log);
}

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
    if (room.teamMode) {
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
    } else {
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
}

module.exports = {
  checkEndgameTrigger,
  awardBonus,
  takeToken,
  applyClimb,
};
