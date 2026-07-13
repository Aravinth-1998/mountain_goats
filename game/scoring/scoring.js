function pointsOf(room, player) {
  let s = 0;
  room.mountains.forEach((m, i) => {
    s += m.value * (player.collected[i] || 0);
  });
  return s;
}

function bonusOf(player) {
  return player.bonus.reduce((a, v) => a + v, 0);
}

function scoreOf(room, player) {
  return pointsOf(room, player) + bonusOf(player);
}

function topsOf(room, player) {
  let n = 0;
  room.mountains.forEach((m, i) => {
    if (player.pos[i] >= m.height) n++;
  });
  return n;
}

function highestTopValue(room, player) {
  let v = 0;
  room.mountains.forEach((m, i) => {
    if (player.pos[i] >= m.height && m.value > v) v = m.value;
  });
  return v;
}

function setsOf(player) {
  return player.collected.reduce((min, c) => Math.min(min, c), Infinity);
}

module.exports = {
  pointsOf,
  bonusOf,
  scoreOf,
  topsOf,
  highestTopValue,
  setsOf,
};
