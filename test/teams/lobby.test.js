const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TEAM_COLORS,
  TEAM_NAMES,
  TEAM_PALETTES,
  PLAYER_COLORS,
} = require('../../game/core/constants');
const {
  getValidTeamConfigs,
  buildTeams,
  getTeamPalette,
  getUsedColors,
  pickTeamColor,
  assignPlayerTeamColor,
  assignAllTeamColors,
  getAllowedColorsForPlayer,
} = require('../../game/teams/lobby');
const { makeRoom } = require('../helpers/fixtures');

test('getValidTeamConfigs returns matching configs by player count', () => {
  assert.deepEqual(getValidTeamConfigs(2), []);
  assert.deepEqual(getValidTeamConfigs(4), [{ total: 4, teams: 2, perTeam: 2 }]);
  assert.deepEqual(getValidTeamConfigs(6), [
    { total: 6, teams: 2, perTeam: 3 },
    { total: 6, teams: 3, perTeam: 2 },
  ]);
});

test('buildTeams round-robin assigns members with team metadata', () => {
  const room = makeRoom({ playerCount: 4, teamMode: false });
  room.teams = null;
  const teams = buildTeams(room, 2);

  assert.equal(teams.length, 2);
  assert.deepEqual(teams[0].members, ['p0', 'p2']);
  assert.deepEqual(teams[1].members, ['p1', 'p3']);
  assert.equal(teams[0].name, TEAM_NAMES[0]);
  assert.equal(teams[1].name, TEAM_NAMES[1]);
  assert.equal(teams[0].color, TEAM_COLORS[0]);
  assert.equal(teams[1].color, TEAM_COLORS[1]);
});

test('getTeamPalette returns palette or null for invalid team id', () => {
  assert.deepEqual(getTeamPalette(0), TEAM_PALETTES[0]);
  assert.equal(getTeamPalette(-1), null);
  assert.equal(getTeamPalette(99), null);
});

test('each team palette has five colors', () => {
  assert.equal(TEAM_PALETTES.length, 3);
  TEAM_PALETTES.forEach((palette) => {
    assert.equal(palette.length, 5);
  });
});

test('getUsedColors excludes the given player', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0].color = '#aaaaaa';
  room.players[1].color = '#bbbbbb';

  const used = getUsedColors(room, 'p0');
  assert.equal(used.has('#aaaaaa'), false);
  assert.equal(used.has('#bbbbbb'), true);
});

test('pickTeamColor picks unused palette color and respects avoidColor', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players[2].color = TEAM_PALETTES[0][0];

  const picked = pickTeamColor(room, 0, 'p0', null);
  assert.ok(TEAM_PALETTES[0].includes(picked));
  assert.notEqual(picked, TEAM_PALETTES[0][0]);

  const avoided = pickTeamColor(room, 0, 'p0', TEAM_PALETTES[0][1]);
  assert.notEqual(avoided, TEAM_PALETTES[0][1]);
  assert.ok(TEAM_PALETTES[0].includes(avoided));
});

test('assignPlayerTeamColor assigns team palette color', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players[0].color = '#000000';

  assignPlayerTeamColor(room, 'p0', false);
  assert.ok(TEAM_PALETTES[0].includes(room.players[0].color));
});

test('assignPlayerTeamColor no-ops when color is already valid and unused', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  const validColor = TEAM_PALETTES[0][0];
  room.players[0].color = validColor;

  assignPlayerTeamColor(room, 'p0', false);
  assert.equal(room.players[0].color, validColor);
});

test('assignAllTeamColors gives each player a unique team-palette color', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players.forEach((p) => {
    p.color = '#000000';
  });

  assignAllTeamColors(room);

  const colors = room.players.map((p) => p.color);
  assert.equal(new Set(colors).size, colors.length);
  room.players.forEach((player, idx) => {
    const teamId = idx % 2;
    assert.ok(TEAM_PALETTES[teamId].includes(player.color));
  });
});

test('getAllowedColorsForPlayer returns team palette for assigned player', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  assert.deepEqual(getAllowedColorsForPlayer(room, 'p0'), TEAM_PALETTES[0]);
  assert.deepEqual(getAllowedColorsForPlayer(room, 'p1'), TEAM_PALETTES[1]);
});

test('getAllowedColorsForPlayer returns union of palettes when player has no team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players.push({
    id: 'guest',
    name: 'Guest',
    color: PLAYER_COLORS[0],
    collected: room.mountains.map(() => 0),
    pos: room.mountains.map(() => 0),
    bonus: [],
    connected: true,
    isBot: false,
    authUserId: null,
  });

  const allowed = getAllowedColorsForPlayer(room, 'guest');
  const expected = [...TEAM_PALETTES[0], ...TEAM_PALETTES[1]];
  assert.deepEqual(allowed, expected);
});

test('getAllowedColorsForPlayer returns all player colors when not in team mode', () => {
  const room = makeRoom({ playerCount: 2, teamMode: false });
  assert.deepEqual(getAllowedColorsForPlayer(room, 'p0'), PLAYER_COLORS);
});
