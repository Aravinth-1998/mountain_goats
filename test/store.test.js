'use strict';

/**
 * Unit tests for the in-memory room store (store.js).
 *
 * Specifically covers the reconnect-after-long-disconnect bug where
 * swapSocket is a no-op (old socket already unregistered by handleDisconnect)
 * and the new socket ends up unregistered, causing all game actions to
 * silently fail (findRoomBySocket returns undefined).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Re-require a fresh store instance for each test by clearing the module cache.
function freshStore() {
  const key = require.resolve('../store');
  delete require.cache[key];
  return require('../store');
}

test('registerSocket and findRoomBySocket work normally', () => {
  const store = freshStore();
  store.setRoom('1234', { code: '1234' });
  store.registerSocket('sock1', '1234');
  assert.deepEqual(store.findRoomBySocket('sock1'), { code: '1234' });
});

test('unregisterSocket removes the mapping', () => {
  const store = freshStore();
  store.setRoom('1234', { code: '1234' });
  store.registerSocket('sock1', '1234');
  store.unregisterSocket('sock1');
  assert.equal(store.findRoomBySocket('sock1'), undefined);
});

test('swapSocket updates the mapping from old to new socket', () => {
  const store = freshStore();
  store.setRoom('1234', { code: '1234' });
  store.registerSocket('old', '1234');
  store.swapSocket('old', 'new', '1234');
  assert.equal(store.findRoomBySocket('old'), undefined);
  assert.deepEqual(store.findRoomBySocket('new'), { code: '1234' });
});

// ── Regression test for the "cannot roll dice after long disconnect" bug ──────
//
// Scenario:
//   1. Player registers with socket "old".
//   2. Player disconnects for >3 s → handleDisconnect fires → unregisterSocket("old").
//   3. Player reconnects with socket "new".
//   4. joinRoom reconnect path calls swapSocket("old", "new") → no-op (old gone).
//   5. BUG (before fix): "new" is never registered → findRoomBySocket("new") = undefined
//      → rollDice / moveGroup / endTurn all silently reject.
//   6. FIX: registerSocket("new", room.code) is called after swapSocket, ensuring
//      the new socket is always in the map.
test('reconnect after handleDisconnect: new socket must be findable', () => {
  const store = freshStore();
  store.setRoom('9999', { code: '9999' });

  // Step 1: player joins
  store.registerSocket('old', '9999');
  assert.ok(store.findRoomBySocket('old'), 'old socket registered');

  // Step 2: handleDisconnect fires (>3 s disconnect) → unregisters old socket
  store.unregisterSocket('old');
  assert.equal(store.findRoomBySocket('old'), undefined, 'old socket removed');

  // Step 3-4: player reconnects; swapSocket always registers newId regardless
  // of whether oldId was still in the map.
  store.swapSocket('old', 'new', '9999');

  // New socket is now findable — rollDice and other handlers will work
  assert.deepEqual(store.findRoomBySocket('new'), { code: '9999' }, 'new socket registered after reconnect');
  assert.equal(store.findRoomBySocket('old'), undefined, 'old socket still absent');
});

test('swapSocket works whether or not old socket is present', () => {
  const store = freshStore();
  store.setRoom('5555', { code: '5555' });
  store.registerSocket('old', '5555');

  store.swapSocket('old', 'new', '5555');

  assert.deepEqual(store.findRoomBySocket('new'), { code: '5555' });
  assert.equal(store.findRoomBySocket('old'), undefined);
});
