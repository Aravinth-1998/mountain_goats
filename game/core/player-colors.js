const { GOAT_COLORS } = require('./constants');

/**
 * @param {string[]} choices Non-empty list.
 * @returns {string}
 */
function pickRandom(choices) {
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Pick a join color: any unused curated goat color. With 10 curated colors
 * and a max of 10 players, every player gets a unique goat.
 *
 * @param {{ players: Array<{ color: string }> }} room Room before the new player is pushed.
 * @returns {string}
 */
function pickJoinColor(room) {
  const players = room && room.players ? room.players : [];
  const used = new Set(players.map((p) => p.color).filter(Boolean));
  const available = GOAT_COLORS.filter((c) => !used.has(c));
  return available.length ? pickRandom(available) : pickRandom(GOAT_COLORS);
}

/**
 * Reassign every player a fresh join color (unique curated goat colors).
 *
 * @param {{ players: Array<{ color: string }> }} room Active room.
 * @returns {void}
 */
function reshuffleJoinColors(room) {
  if (!room || !room.players || !room.players.length) return;
  const tempRoom = { players: [] };
  for (const player of room.players) {
    const color = pickJoinColor(tempRoom);
    player.color = color;
    tempRoom.players.push({ color });
  }
}

module.exports = {
  pickJoinColor,
  reshuffleJoinColors,
};
