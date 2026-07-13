const { BONUS_DEFS } = require('./constants');
const { buildMountains } = require('./mountains');

function createPlaceholderMountains() {
  return buildMountains(4);
}

function createBonusTokens() {
  return [...BONUS_DEFS];
}

function resetForNewGame(room) {
  const count = room.players.filter((p) => p.connected).length || room.players.length;
  room.mountains = buildMountains(count);
  room.bonusTokens = createBonusTokens();
  room.lastRound = false;
  room.endReason = null;
  room.startedAt = null;
  room.finished = false;
  room.winnerId = null;
  room.winnerPlayerIds = [];
  room.winnerTeamId = null;
  room.currentIndex = 0;
  room.dice = null;
  room.diceUsed = [];
  room.adjustable = [];
  room.rolled = false;
  room.players.forEach((p) => {
    p.pos = room.mountains.map(() => 0);
    p.collected = room.mountains.map(() => 0);
    p.bonus = [];
    p.turns = 0;
  });
}

module.exports = {
  createPlaceholderMountains,
  createBonusTokens,
  resetForNewGame,
};
