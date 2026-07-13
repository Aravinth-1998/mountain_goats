const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pointsOf,
  bonusOf,
  scoreOf,
  setsOf,
} = require('../../game/scoring/scoring');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('pointsOf sums mountain value times collected tokens', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = makePlayer({
    collected: [2, 1, 0, 0, 0, 0],
  });
  assert.equal(pointsOf(room, player), 16);
});

test('bonusOf sums bonus token values', () => {
  const player = makePlayer({ bonus: [15, 9] });
  assert.equal(bonusOf(player), 24);
});

test('scoreOf combines points and bonus', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = makePlayer({
    collected: [1, 0, 0, 0, 0, 0],
    bonus: [6],
  });
  assert.equal(scoreOf(room, player), 11);
});

test('setsOf returns minimum collected count', () => {
  assert.equal(setsOf(makePlayer({ collected: [2, 1, 3, 0, 0, 0] })), 0);
  assert.equal(setsOf(makePlayer({ collected: [2, 2, 2, 2, 2, 2] })), 2);
  assert.equal(setsOf(makePlayer({ collected: [3, 3, 3, 3, 3, 3] })), 3);
});
