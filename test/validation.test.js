const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  safePayload,
  toInt,
  toBoundedString,
  toBool,
  isDistinctIntArray,
  safeHandler,
} = require('../game/validation');

test('safePayload returns plain objects unchanged', () => {
  const p = { a: 1 };
  assert.equal(safePayload(p), p);
});

test('safePayload replaces null and undefined with an empty object so destructuring is safe', () => {
  // Regression: raw socket handlers do `({ x }) => ...` — a client sending
  // `null` or omitting the payload used to throw a TypeError that took the
  // room's turn down with it.
  assert.deepEqual(safePayload(null), {});
  assert.deepEqual(safePayload(undefined), {});
});

test('safePayload replaces primitives and arrays (destructuring would silently give undefined)', () => {
  assert.deepEqual(safePayload(42), {});
  assert.deepEqual(safePayload('hello'), {});
  assert.deepEqual(safePayload(true), {});
  assert.deepEqual(safePayload([1, 2, 3]), {}, 'arrays are destructured as {} in game handlers');
});

test('toInt coerces numeric strings and rejects garbage', () => {
  assert.equal(toInt('4'), 4);
  assert.equal(toInt(4), 4);
  assert.equal(toInt('4.9'), 4, 'parseInt truncates');
  assert.equal(toInt('abc'), null);
  assert.equal(toInt(null), null);
  assert.equal(toInt(undefined), null);
  assert.equal(toInt(NaN), null);
  assert.equal(toInt(Infinity), null);
});

test('toInt enforces min and max bounds inclusively', () => {
  assert.equal(toInt(2, { min: 2, max: 10 }), 2);
  assert.equal(toInt(10, { min: 2, max: 10 }), 10);
  assert.equal(toInt(1, { min: 2, max: 10 }), null);
  assert.equal(toInt(11, { min: 2, max: 10 }), null);
});

test('toBoundedString trims and caps length', () => {
  assert.equal(toBoundedString('  hi  '), 'hi');
  assert.equal(toBoundedString(''), null);
  assert.equal(toBoundedString('   '), null);
  assert.equal(toBoundedString(42), null);
  assert.equal(toBoundedString('a'.repeat(500), { maxLength: 10 }), 'a'.repeat(10));
});

test('toBool handles boolean, numeric, and string conventions', () => {
  assert.equal(toBool(true), true);
  assert.equal(toBool(false), false);
  assert.equal(toBool('true'), true);
  assert.equal(toBool('false'), false);
  assert.equal(toBool(1), true);
  assert.equal(toBool(0), false);
  assert.equal(toBool(undefined), false);
});

test('isDistinctIntArray accepts valid arrays and rejects everything else', () => {
  assert.equal(isDistinctIntArray([0, 1, 2], { min: 0, max: 3, maxLength: 4 }), true);
  assert.equal(isDistinctIntArray([], { min: 0, max: 3, maxLength: 4 }), true, 'empty is allowed by default');
  assert.equal(isDistinctIntArray([0, 0], { min: 0, max: 3, maxLength: 4 }), false, 'duplicates rejected');
  assert.equal(isDistinctIntArray([0, 1.5], { min: 0, max: 3, maxLength: 4 }), false, 'non-integers rejected');
  assert.equal(isDistinctIntArray([0, 'x'], { min: 0, max: 3, maxLength: 4 }), false, 'non-number rejected');
  assert.equal(isDistinctIntArray([0, 5], { min: 0, max: 3, maxLength: 4 }), false, 'out-of-range rejected');
  assert.equal(isDistinctIntArray('not-array', { min: 0, max: 3, maxLength: 4 }), false);
});

test('isDistinctIntArray enforces minLength and maxLength', () => {
  assert.equal(isDistinctIntArray([0, 1, 2, 3, 4], { min: 0, max: 9, maxLength: 4 }), false, 'over max rejected');
  assert.equal(isDistinctIntArray([], { min: 0, max: 9, minLength: 1, maxLength: 4 }), false, 'under min rejected');
  assert.equal(isDistinctIntArray([0], { min: 0, max: 9, minLength: 1, maxLength: 4 }), true);
});

test('safeHandler swallows synchronous throws and acks the caller with an error', () => {
  let ackCalledWith = null;
  const wrapped = safeHandler('bad', () => { throw new Error('boom'); });
  wrapped({}, (result) => { ackCalledWith = result; });
  assert.deepEqual(ackCalledWith, { error: 'Server error, please try again.' });
});

test('safeHandler tolerates a missing ack callback', () => {
  const wrapped = safeHandler('bad', () => { throw new Error('boom'); });
  assert.doesNotThrow(() => wrapped({}, null));
  assert.doesNotThrow(() => wrapped({}));
});

test('safeHandler normalizes a null payload before calling the handler', () => {
  let seen = null;
  const wrapped = safeHandler('ok', (payload) => { seen = payload; });
  wrapped(null);
  assert.deepEqual(seen, {}, 'handler receives {} instead of null');
});

test('safeHandler catches async rejections and acks the caller', async () => {
  let ackCalledWith = null;
  const wrapped = safeHandler('bad-async', async () => { throw new Error('boom'); });
  await new Promise((resolve) => {
    wrapped({}, (r) => { ackCalledWith = r; resolve(); });
    // ack will be called once the async chain settles; use setImmediate as a fallback
    setTimeout(resolve, 50);
  });
  assert.deepEqual(ackCalledWith, { error: 'Server error, please try again.' });
});

test('safeHandler passes the ack through when the handler returns normally', () => {
  let ackCalledWith = null;
  const wrapped = safeHandler('ok', (_payload, ack) => ack({ ok: true, value: 7 }));
  wrapped({ x: 1 }, (r) => { ackCalledWith = r; });
  assert.deepEqual(ackCalledWith, { ok: true, value: 7 });
});

test('safeHandler treats a lone function arg as the ack (Socket.IO ack-only emit)', () => {
  // Regression: socket.emit('getPublicRooms', cb) arrives as wrapped(cb) with no
  // payload. Without this, the public-rooms list never updates after toggling Public.
  let ackCalledWith = null;
  let seenPayload = null;
  const wrapped = safeHandler('ok', (payload, ack) => {
    seenPayload = payload;
    ack(['room-a']);
  });
  wrapped((r) => { ackCalledWith = r; });
  assert.deepEqual(seenPayload, {});
  assert.deepEqual(ackCalledWith, ['room-a']);
});

test('safeHandler ignores a non-function ack instead of calling it', () => {
  let handlerAck = 'sentinel';
  const wrapped = safeHandler('ok', (_payload, ack) => { handlerAck = ack; });
  assert.doesNotThrow(() => wrapped({}, 'not-a-function'));
  assert.equal(handlerAck, null, 'handler sees null when the caller\'s ack is not a function');
});
