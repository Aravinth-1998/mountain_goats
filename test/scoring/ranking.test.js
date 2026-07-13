const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankedPlayers, winnerSlotCount } = require('../../game/scoring/ranking');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('rankedPlayers breaks ties by more tops', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0] = makePlayer({
    id: 'p0',
    collected: [1, 1, 0, 0, 0, 0],
    pos: [4, 0, 0, 0, 0, 0],
  });
  room.players[1] = makePlayer({
    id: 'p1',
    collected: [1, 1, 0, 0, 0, 0],
    pos: [4, 4, 0, 0, 0, 0],
  });
  const ranked = rankedPlayers(room);
  assert.equal(ranked[0].p.id, 'p1');
});

test('rankedPlayers breaks score and tops ties by higher mountain summit', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0] = makePlayer({
    id: 'p0',
    collected: [0, 0, 0, 0, 1, 0],
    pos: [0, 0, 0, 0, 2, 0],
  });
  room.players[1] = makePlayer({
    id: 'p1',
    collected: [0, 0, 0, 0, 0, 1],
    pos: [0, 0, 0, 0, 0, 2],
  });
  const ranked = rankedPlayers(room);
  assert.equal(ranked[0].p.id, 'p1');
});

test('winnerSlotCount returns 1 for 4 players and 2 for 5 players', () => {
  assert.equal(winnerSlotCount(makeRoom({ playerCount: 4 })), 1);
  assert.equal(winnerSlotCount(makeRoom({ playerCount: 5 })), 2);
});
