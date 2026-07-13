const { MOUNTAIN_DEFS } = require('./constants');

function buildMountains(numPlayers) {
  const removal = Math.max(0, 4 - numPlayers);
  return MOUNTAIN_DEFS.map((m) => ({
    value: m.value,
    height: m.height,
    color: m.color,
    fullStack: m.fullStack,
    chips: Math.max(0, m.fullStack - removal),
  }));
}

function emptyMountainCount(room) {
  return room.mountains.reduce((a, m) => a + (m.chips <= 0 ? 1 : 0), 0);
}

module.exports = {
  buildMountains,
  emptyMountainCount,
};
