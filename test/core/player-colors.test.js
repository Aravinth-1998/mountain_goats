const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickJoinColor, colorGroupIndex } = require('../../game/core/player-colors');
const { PLAYER_COLORS } = require('../../game/core/constants');

test('first four joins use four different color groups', () => {
  const room = { players: [] };
  const groups = new Set();
  for (let playerIndex = 0; playerIndex < 4; playerIndex++) {
    const color = pickJoinColor(room);
    const groupIndex = colorGroupIndex(color);
    assert.ok(groupIndex >= 0);
    assert.equal(groups.has(groupIndex), false);
    groups.add(groupIndex);
    room.players.push({ color });
  }
  assert.equal(groups.size, 4);
});

test('second round of four also uses four different color groups', () => {
  const room = { players: [] };
  for (let playerIndex = 0; playerIndex < 8; playerIndex++) {
    room.players.push({ color: pickJoinColor(room) });
  }
  const secondRound = room.players.slice(4, 8).map((player) => colorGroupIndex(player.color));
  assert.equal(new Set(secondRound).size, 4);
});

test('ninth and tenth joins pick any unused color', () => {
  const room = { players: [] };
  for (let playerIndex = 0; playerIndex < 10; playerIndex++) {
    room.players.push({ color: pickJoinColor(room) });
  }
  const colors = room.players.map((player) => player.color);
  assert.equal(new Set(colors).size, 10);
  assert.equal(colors.every((color) => PLAYER_COLORS.includes(color)), true);
});

test('reshuffleJoinColors reassigns unique colors with group rules', () => {
  const { reshuffleJoinColors } = require('../../game/core/player-colors');
  const room = {
    players: [
      { color: '#000000' },
      { color: '#111111' },
      { color: '#222222' },
      { color: '#333333' },
    ],
  };
  reshuffleJoinColors(room);
  const groups = new Set(room.players.map((player) => colorGroupIndex(player.color)));
  assert.equal(groups.size, 4);
  assert.equal(new Set(room.players.map((player) => player.color)).size, 4);
});

test('switching to standardTeam then standard reshuffles off team palettes', () => {
  const { setRoomMode } = require('../../game/modes');
  const { TEAM_PALETTES } = require('../../game/core/constants');
  const { makeRoom } = require('../helpers/fixtures');

  const room = makeRoom({ playerCount: 4, modeId: 'standard' });
  setRoomMode(room, 'standardTeam', () => {});
  assert.equal(room.teamMode, true);
  assert.equal(room.teams.length, 2);
  for (const player of room.players) {
    const onRedOrBlue = TEAM_PALETTES[0].includes(player.color) || TEAM_PALETTES[1].includes(player.color);
    assert.ok(onRedOrBlue, `expected red/blue palette color, got ${player.color}`);
  }

  const teamColors = room.players.map((p) => p.color).join(',');
  setRoomMode(room, 'standard', () => {});
  assert.equal(room.teamMode, false);
  assert.equal(room.teams, null);
  const groups = new Set(room.players.map((player) => colorGroupIndex(player.color)));
  assert.equal(groups.size, 4);
  assert.equal(room.players.every((player) => PLAYER_COLORS.includes(player.color)), true);
  assert.ok(teamColors.length > 0);
});
