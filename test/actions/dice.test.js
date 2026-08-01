const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyOnesRule, adjustDie } = require('../../game/actions/dice');

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

function makeAdjustableRoom(dice = [1, 1, 1, 4]) {
  const room = { dice: [...dice], diceUsed: dice.map(() => false), adjustable: [] };
  applyOnesRule(room);
  return room;
}

test('adjustDie re-faces the target die to the requested value', () => {
  const room = makeAdjustableRoom();
  assert.equal(adjustDie(room, 0, 5), true);
  assert.equal(room.dice[0], 5);
});

test('adjustDie allows re-facing the same die again before any climb', () => {
  const room = makeAdjustableRoom();
  assert.equal(adjustDie(room, 0, 6), true);
  assert.equal(adjustDie(room, 0, 3), true, 'may change mind until a climb starts');
  assert.equal(room.dice[0], 3);
  assert.deepEqual(room.adjustable, [0, 1], 'adjustable slots stay open');
});

test('adjustDie after 1 to 2 still allows another face pick', () => {
  const room = makeAdjustableRoom([1, 1, 3, 4]);
  assert.deepEqual(room.adjustable, [0]);
  assert.equal(adjustDie(room, 0, 2), true);
  assert.equal(room.dice[0], 2);
  assert.deepEqual(room.adjustable, [0]);
  assert.equal(adjustDie(room, 0, 6), true);
  assert.equal(room.dice[0], 6);
});

test('adjustDie rejects indices that are not in adjustable', () => {
  const room = makeAdjustableRoom();
  assert.equal(adjustDie(room, 2, 4), false); // index 2 is a legitimate 1, not an extra
  assert.equal(room.dice[2], 1);
});

test('adjustDie rejects out-of-range and non-integer values', () => {
  const room = makeAdjustableRoom();
  assert.equal(adjustDie(room, 0, 0), false);
  assert.equal(adjustDie(room, 0, 7), false);
  assert.equal(adjustDie(room, 0, 'six'), false);
  assert.equal(adjustDie(room, 0, null), false);
  assert.equal(room.dice[0], 1, 'die is unchanged when the target value is invalid');
});

test('adjustDie is locked once any die has been used for a climb', () => {
  const room = makeAdjustableRoom();
  room.diceUsed[3] = true; // any move started
  assert.equal(adjustDie(room, 0, 5), false);
  assert.equal(room.dice[0], 1);
});

test('adjustDie accepts numeric strings so socket payloads validate cleanly', () => {
  const room = makeAdjustableRoom();
  assert.equal(adjustDie(room, 0, '4'), true);
  assert.equal(room.dice[0], 4);
});
