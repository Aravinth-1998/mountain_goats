const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pointsOf, bonusOf, scoreOf, topsOf, highestTopValue, setsOf } = require('../../game/scoring/scoring');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

// Mountains: 0=val5(h4), 1=val6(h4), 2=val7(h3), 3=val8(h3), 4=val9(h2), 5=val10(h2)

test('pointsOf returns 0 for player with no tokens', () => {
  const room = makeRoom();
  const player = room.players[0]; // collected defaults to [0,0,0,0,0,0]
  assert.equal(pointsOf(room, player), 0);
});

test('pointsOf handles all mountains collected', () => {
  const room = makeRoom();
  const player = room.players[0];
  player.collected = [1, 1, 1, 1, 1, 1];
  assert.equal(pointsOf(room, player), 5 + 6 + 7 + 8 + 9 + 10);
});

test('bonusOf returns 0 for empty bonus array', () => {
  const player = makePlayer({ bonus: [] });
  assert.equal(bonusOf(player), 0);
});

test('bonusOf handles single bonus token', () => {
  const player = makePlayer({ bonus: [15] });
  assert.equal(bonusOf(player), 15);
});

test('scoreOf with zero points and zero bonus returns 0', () => {
  const room = makeRoom();
  const player = room.players[0]; // collected all 0, bonus []
  assert.equal(scoreOf(room, player), 0);
});

test('topsOf returns 0 when no summits held', () => {
  const room = makeRoom();
  const player = room.players[0]; // pos defaults to [0,0,0,0,0,0]
  assert.equal(topsOf(room, player), 0);
});

test('topsOf counts all 6 summits', () => {
  const room = makeRoom();
  const player = room.players[0];
  player.pos = [4, 4, 3, 3, 2, 2]; // each at mountain height
  assert.equal(topsOf(room, player), 6);
});

test('topsOf correctly checks against mountain height', () => {
  const room = makeRoom();
  const player = room.players[0];
  player.pos = [3, 0, 0, 0, 0, 0]; // pos[0]=3, height is 4 → not at top
  assert.equal(topsOf(room, player), 0);
});

test('highestTopValue returns 0 when no summits held', () => {
  const room = makeRoom();
  const player = room.players[0];
  assert.equal(highestTopValue(room, player), 0);
});

test('highestTopValue returns highest mountain value among summits', () => {
  const room = makeRoom();
  const player = room.players[0];
  // At top of mountain 0 (value 5, height 4) and mountain 5 (value 10, height 2)
  player.pos = [4, 0, 0, 0, 0, 2];
  assert.equal(highestTopValue(room, player), 10);
});

test('setsOf returns 0 when any mountain has 0 collected', () => {
  const player = makePlayer({ collected: [3, 2, 0, 1, 1, 1] });
  assert.equal(setsOf(player), 0);
});

test('setsOf returns Infinity for empty collected array', () => {
  const player = makePlayer({ collected: [] });
  assert.equal(setsOf(player), Infinity);
});

test('setsOf with one complete set returns 1', () => {
  const player = makePlayer({ collected: [1, 1, 1, 1, 1, 1] });
  assert.equal(setsOf(player), 1);
});
