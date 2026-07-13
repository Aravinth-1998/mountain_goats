const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildMountains, emptyMountainCount } = require('../../game/core/mountains');
const { makeRoom } = require('../helpers/fixtures');

test('buildMountains removes 2 chips per mountain for 2 players', () => {
  const mountains = buildMountains(2);
  assert.equal(mountains[0].chips, 10);
  assert.equal(mountains[5].chips, 5);
});

test('buildMountains removes 1 chip per mountain for 3 players', () => {
  const mountains = buildMountains(3);
  assert.equal(mountains[0].chips, 11);
  assert.equal(mountains[5].chips, 6);
});

test('buildMountains uses full stack for 4+ players', () => {
  const mountains = buildMountains(4);
  assert.equal(mountains[0].chips, 12);
  assert.equal(mountains[5].chips, 7);
});

test('emptyMountainCount counts mountains with no chips', () => {
  const room = makeRoom({ playerCount: 2 });
  room.mountains[0].chips = 0;
  room.mountains[2].chips = 0;
  assert.equal(emptyMountainCount(room), 2);
});
