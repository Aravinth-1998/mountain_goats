const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyClimb } = require('../../game/actions/climb');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

function collectLogs(fn) {
  const logs = [];
  fn((msg) => logs.push(msg));
  return logs;
}

test('standard mode: reaching summit takes token and bumps opponent', () => {
  const room = makeRoom({ playerCount: 2 });
  const climber = room.players[0];
  const opponent = room.players[1];
  climber.pos[0] = 3;
  opponent.pos[0] = 4;
  const chipsBefore = room.mountains[0].chips;

  collectLogs((log) => applyClimb(room, climber, 0, log));

  assert.equal(climber.pos[0], 4);
  assert.equal(climber.collected[0], 1);
  assert.equal(opponent.pos[0], 0);
  assert.equal(room.mountains[0].chips, chipsBefore - 1);
});

test('standard mode: harvesting on summit takes another token', () => {
  const room = makeRoom({ playerCount: 2 });
  const climber = room.players[0];
  climber.pos[0] = 4;
  const chipsBefore = room.mountains[0].chips;

  collectLogs((log) => applyClimb(room, climber, 0, log));

  assert.equal(climber.collected[0], 1);
  assert.equal(room.mountains[0].chips, chipsBefore - 1);
});

test('team mode: co-occupies summit with teammate and wipes opponent team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  const climber = room.players[2];
  const teammate = room.players[0];
  const opponent = room.players[1];
  climber.pos[0] = 3;
  teammate.pos[0] = 4;
  opponent.pos[0] = 4;

  collectLogs((log) => applyClimb(room, climber, 0, log));

  assert.equal(climber.pos[0], 4);
  assert.equal(teammate.pos[0], 4);
  assert.equal(opponent.pos[0], 0);
  assert.equal(climber.collected[0], 1);
});
