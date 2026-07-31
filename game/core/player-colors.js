const { PLAYER_COLORS, PLAYER_COLOR_GROUPS } = require('./constants');

/** Players per balanced color-group round (red/blue/green/other). */
const JOIN_COLOR_ROUND_SIZE = 4;

/** Max players that use one-from-each-group assignment before free picks. */
const JOIN_COLOR_GROUPED_LIMIT = JOIN_COLOR_ROUND_SIZE * 2;

const COLOR_TO_GROUP = new Map();
PLAYER_COLOR_GROUPS.forEach((group, groupIndex) => {
  group.forEach((color) => COLOR_TO_GROUP.set(color, groupIndex));
});

/**
 * @param {string[]} choices Non-empty list.
 * @returns {string}
 */
function pickRandom(choices) {
  return choices[Math.floor(Math.random() * choices.length)];
}

/**
 * Index of the color group for a hex, or -1 when unknown.
 *
 * @param {string} color Hex color.
 * @returns {number}
 */
function colorGroupIndex(color) {
  if (!color) return -1;
  const groupIndex = COLOR_TO_GROUP.get(color);
  return groupIndex == null ? -1 : groupIndex;
}

/**
 * Pick a join color: first 4 players get one each from red/blue/green/other,
 * next 4 do the same, then remaining seats take any unused color.
 *
 * @param {{ players: Array<{ color: string }> }} room Room before the new player is pushed.
 * @returns {string}
 */
function pickJoinColor(room) {
  const players = room && room.players ? room.players : [];
  const used = new Set(players.map((p) => p.color).filter(Boolean));

  /**
   * @returns {string}
   */
  function anyUnused() {
    const available = PLAYER_COLORS.filter((c) => !used.has(c));
    return available.length ? pickRandom(available) : pickRandom(PLAYER_COLORS);
  }

  const joinIndex = players.length;
  if (joinIndex >= JOIN_COLOR_GROUPED_LIMIT) return anyUnused();

  const roundStart = Math.floor(joinIndex / JOIN_COLOR_ROUND_SIZE) * JOIN_COLOR_ROUND_SIZE;
  const usedGroupIndexes = new Set();
  for (let i = roundStart; i < players.length; i++) {
    const groupIndex = colorGroupIndex(players[i].color);
    if (groupIndex >= 0) usedGroupIndexes.add(groupIndex);
  }

  const openGroups = [];
  for (let groupIndex = 0; groupIndex < PLAYER_COLOR_GROUPS.length; groupIndex++) {
    if (usedGroupIndexes.has(groupIndex)) continue;
    const candidates = PLAYER_COLOR_GROUPS[groupIndex].filter((c) => !used.has(c));
    if (candidates.length) openGroups.push(candidates);
  }

  if (!openGroups.length) return anyUnused();
  return pickRandom(pickRandom(openGroups));
}

/**
 * Reassign every player a fresh join color using the grouped random rules.
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
  JOIN_COLOR_ROUND_SIZE,
  JOIN_COLOR_GROUPED_LIMIT,
  pickJoinColor,
  colorGroupIndex,
  reshuffleJoinColors,
};
