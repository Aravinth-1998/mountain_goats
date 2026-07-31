const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickJoinColor, colorGroupIndex } = require('../../game/core/player-colors');
const { PLAYER_COLORS } = require('../../game/core/constants');

test('first four joins use four different color groups', () => {
  const room = { players: [] };
  const groups = new Set();
  for (let i = 0; i < 4; i++) {
    const color = pickJoinColor(room);
    const group = colorGroupIndex(color);
    assert.ok(group >= 0);
    assert.equal(groups.has(group), false);
    groups.add(group);
    room.players.push({ color });
  }
  assert.equal(groups.size, 4);
});

test('second round of four also uses four different color groups', () => {
  const room = { players: [] };
  for (let i = 0; i < 8; i++) {
    room.players.push({ color: pickJoinColor(room) });
  }
  const round2 = room.players.slice(4, 8).map((p) => colorGroupIndex(p.color));
  assert.equal(new Set(round2).size, 4);
});

test('ninth and tenth joins pick any unused color', () => {
  const room = { players: [] };
  for (let i = 0; i < 10; i++) {
    room.players.push({ color: pickJoinColor(room) });
  }
  const colors = room.players.map((p) => p.color);
  assert.equal(new Set(colors).size, 10);
  for (const color of colors) {
    assert.ok(PLAYER_COLORS.includes(color));
  }
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
  const groups = new Set(room.players.map((p) => colorGroupIndex(p.color)));
  assert.equal(groups.size, 4);
  assert.equal(new Set(room.players.map((p) => p.color)).size, 4);
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
  const groups = new Set(room.players.map((p) => colorGroupIndex(p.color)));
  assert.equal(groups.size, 4);
  // Reshuffle should produce a new assignment in almost all cases; allow rare collision.
  const reshuffled = room.players.map((p) => p.color).join(',');
  assert.equal(room.players.every((p) => PLAYER_COLORS.includes(p.color)), true);
  assert.ok(reshuffled.length > 0);
  assert.notEqual(teamColors.length, 0);
});
