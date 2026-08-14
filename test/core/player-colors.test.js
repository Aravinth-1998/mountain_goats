const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pickJoinColor } = require('../../game/core/player-colors');
const { GOAT_COLORS } = require('../../game/core/constants');

test('each of the first 10 joins gets a unique curated goat color', () => {
  const room = { players: [] };
  const colors = [];
  for (let i = 0; i < 10; i++) {
    const color = pickJoinColor(room);
    assert.ok(GOAT_COLORS.includes(color), `expected curated color, got ${color}`);
    assert.equal(colors.includes(color), false, `duplicate color ${color}`);
    colors.push(color);
    room.players.push({ color });
  }
  assert.equal(new Set(colors).size, 10);
});

test('all curated colors are valid player colors', () => {
  const { PLAYER_COLORS } = require('../../game/core/constants');
  for (const color of GOAT_COLORS) {
    assert.ok(PLAYER_COLORS.includes(color), `missing from PLAYER_COLORS: ${color}`);
  }
});

test('reshuffleJoinColors reassigns unique curated colors', () => {
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
  const colors = room.players.map((p) => p.color);
  assert.equal(new Set(colors).size, 4);
  assert.ok(colors.every((c) => GOAT_COLORS.includes(c)));
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
  const colors = room.players.map((p) => p.color);
  assert.equal(new Set(colors).size, 4);
  assert.ok(colors.every((c) => GOAT_COLORS.includes(c)));
  assert.ok(teamColors.length > 0);
});
