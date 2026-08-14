const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canStart, prepareStart, onSetMode, onClearMode, syncLobbyForStart } = require('../../game/modes/standard/lobby');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('canStart returns ok:true with 2 players', () => {
  const room = makeRoom({ playerCount: 2 });
  const result = canStart(room);
  assert.equal(result.ok, true);
});

test('canStart returns ok:false with 1 player', () => {
  const room = makeRoom({ playerCount: 1 });
  const result = canStart(room);
  assert.equal(result.ok, false);
});

test('canStart returns ok:true with 10 players', () => {
  const room = makeRoom({ playerCount: 10 });
  const result = canStart(room);
  assert.equal(result.ok, true);
});

test('prepareStart shuffles player order', () => {
  const room = makeRoom({ playerCount: 6 });
  const originalIds = room.players.map(p => p.id);
  let sawDifferentOrder = false;

  for (let i = 0; i < 20; i++) {
    const r = makeRoom({ playerCount: 6 });
    prepareStart(r);
    const shuffledIds = r.players.map(p => p.id);
    if (shuffledIds.some((id, idx) => id !== originalIds[idx])) {
      sawDifferentOrder = true;
      break;
    }
  }

  assert.ok(sawDifferentOrder, 'Expected at least one shuffled order to differ from original');
});

test('prepareStart preserves all players', () => {
  const room = makeRoom({ playerCount: 4 });
  const idsBefore = room.players.map(p => p.id).sort();
  prepareStart(room);
  const idsAfter = room.players.map(p => p.id).sort();
  assert.deepEqual(idsAfter, idsBefore);
});

test('onSetMode clears teams and winnerTeamId', () => {
  const room = makeRoom({ playerCount: 4 });
  room.teams = [{ id: 0, name: 'Red', members: ['p0', 'p1'] }];
  room.winnerTeamId = 0;
  onSetMode(room);
  assert.equal(room.teams, null);
  assert.equal(room.winnerTeamId, null);
});

test('syncLobbyForStart is a no-op for standard mode', () => {
  const room = makeRoom({ playerCount: 4 });
  const snapshot = JSON.parse(JSON.stringify(room));
  syncLobbyForStart(room);
  assert.deepEqual(room, snapshot);
});
