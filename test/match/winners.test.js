const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getWinningAuthUserIds,
  buildMatchStatUpdates,
  resolveWinners,
} = require('../../game/match/winners');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('getWinningAuthUserIds returns 1 winner for 4p standard mode', () => {
  const room = makeRoom({ playerCount: 4 });
  room.players[0].authUserId = 'user-a';
  room.players[1].authUserId = 'user-b';
  room.winnerPlayerIds = [room.players[0].id];

  const winners = getWinningAuthUserIds(room);
  assert.equal(winners.size, 1);
  assert.ok(winners.has('user-a'));
});

test('getWinningAuthUserIds returns 2 winners for 5p standard mode', () => {
  const room = makeRoom({ playerCount: 5 });
  room.players[0].authUserId = 'user-a';
  room.players[1].authUserId = 'user-b';
  room.players[2].authUserId = 'user-c';
  room.winnerPlayerIds = [room.players[0].id, room.players[1].id];

  const winners = getWinningAuthUserIds(room);
  assert.equal(winners.size, 2);
  assert.ok(winners.has('user-a'));
  assert.ok(winners.has('user-b'));
});

test('getWinningAuthUserIds returns all signed-in members of winning team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players[0].authUserId = 'user-a';
  room.players[2].authUserId = 'user-b';
  room.winnerTeamId = 0;

  const winners = getWinningAuthUserIds(room);
  assert.equal(winners.size, 2);
  assert.ok(winners.has('user-a'));
  assert.ok(winners.has('user-b'));
});

test('buildMatchStatUpdates marks winners and losers', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0] = makePlayer({ id: 'p0', authUserId: 'winner' });
  room.players[1] = makePlayer({ id: 'p1', authUserId: 'loser' });
  room.winnerPlayerIds = ['p0'];

  const updates = buildMatchStatUpdates(room);
  assert.equal(updates.length, 2);
  const winnerUpdate = updates.find((u) => u.userId === 'winner');
  const loserUpdate = updates.find((u) => u.userId === 'loser');
  assert.equal(winnerUpdate.won, true);
  assert.equal(loserUpdate.won, false);
});

test('resolveWinners picks single winner in 2p standard mode', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0].collected = [2, 0, 0, 0, 0, 0];
  room.players[1].collected = [0, 1, 0, 0, 0, 0];

  resolveWinners(room);

  assert.equal(room.finished, true);
  assert.equal(room.winnerId, 'p0');
  assert.deepEqual(room.winnerPlayerIds, ['p0']);
});

test('resolveWinners picks two winners in 5p standard mode', () => {
  const room = makeRoom({ playerCount: 5 });
  room.players[0].collected = [3, 0, 0, 0, 0, 0];
  room.players[1].collected = [2, 0, 0, 0, 0, 0];
  room.players[2].collected = [1, 0, 0, 0, 0, 0];

  resolveWinners(room);

  assert.equal(room.winnerPlayerIds.length, 2);
  assert.equal(room.winnerId, 'p0');
  assert.ok(room.winnerPlayerIds.includes('p1'));
});

test('resolveWinners picks winning team in team mode', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.players[0].collected = [2, 0, 0, 0, 0, 0];
  room.players[2].collected = [1, 0, 0, 0, 0, 0];
  room.players[1].collected = [0, 1, 0, 0, 0, 0];

  resolveWinners(room);

  assert.equal(room.winnerTeamId, 0);
  assert.equal(room.winnerId, 'p0');
  assert.deepEqual(room.winnerPlayerIds, []);
});
