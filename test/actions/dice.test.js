const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyOnesRule } = require('../../game/actions/dice');

test('applyOnesRule leaves adjustable empty with 0-1 ones', () => {
  const room = { dice: [1, 3, 4, 5], adjustable: [] };
  applyOnesRule(room);
  assert.deepEqual(room.adjustable, []);

  room.dice = [2, 3, 4, 5];
  applyOnesRule(room);
  assert.deepEqual(room.adjustable, []);
});

test('applyOnesRule marks all but one 1 as adjustable', () => {
  const room = { dice: [1, 1, 3, 4], adjustable: [] };
  applyOnesRule(room);
  assert.deepEqual(room.adjustable, [0]);

  room.dice = [1, 1, 1, 4];
  applyOnesRule(room);
  assert.deepEqual(room.adjustable, [0, 1]);
});
