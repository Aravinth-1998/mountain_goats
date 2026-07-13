const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEndgameTrigger } = require('../../game/actions/climb');
const { makeRoom } = require('../helpers/fixtures');

test('checkEndgameTrigger sets lastRound when 3 mountains are empty', () => {
  const room = makeRoom({ playerCount: 2 });
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;
  room.mountains[2].chips = 0;

  const logs = [];
  checkEndgameTrigger(room, (msg) => logs.push(msg));

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'empty');
  assert.match(logs[0], /3 mountains emptied/);
});

test('checkEndgameTrigger sets lastRound when all bonus tokens are gone', () => {
  const room = makeRoom({ playerCount: 2, bonusTokens: [] });

  const logs = [];
  checkEndgameTrigger(room, (msg) => logs.push(msg));

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'bonus');
  assert.match(logs[0], /all Bonus Tokens claimed/);
});
