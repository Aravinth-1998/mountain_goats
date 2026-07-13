const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  teamScoreOf,
  teamTopsOf,
  teamHasSummit,
} = require('../../game/teams/scoring');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('teamScoreOf sums member scores', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players[0].collected = [2, 0, 0, 0, 0, 0];
  room.players[2].collected = [0, 1, 0, 0, 0, 0];
  const team = room.teams[0];
  assert.equal(teamScoreOf(room, team), 16);
});

test('teamTopsOf counts summits with any teammate on top', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players[0].pos = [4, 0, 0, 0, 0, 0];
  room.players[2].pos = [0, 4, 0, 0, 0, 0];
  const team = room.teams[0];
  assert.equal(teamTopsOf(room, team), 2);
});

test('teamHasSummit detects teammate already on summit', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  const climber = room.players[2];
  const teammate = room.players[0];
  teammate.pos[0] = 4;
  assert.equal(teamHasSummit(room, climber, 0), true);
});
