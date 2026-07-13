/**
 * Returns true if the current player should be auto-played (bot or disconnected human).
 *
 * @param {object} room Active room.
 * @returns {boolean}
 */
function shouldBotPlay(room) {
  if (!room || !room.started || room.finished) return false;
  const cur = room.players[room.currentIndex];
  if (!cur) return false;
  if (cur.isBot) return true;
  if (!cur.connected) return true;
  return false;
}

module.exports = {
  shouldBotPlay,
};
