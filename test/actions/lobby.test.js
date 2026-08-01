const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cancelLobbyCleanup, removePlayerFromLobby } = require('../../game/actions/lobby');

function makeRoom(overrides = {}) {
  return {
    code: '1234',
    hostId: 'a',
    currentIndex: 0,
    players: [
      { id: 'a', name: 'Alice', isBot: false, connected: true },
      { id: 'b', name: 'Bob', isBot: false, connected: true },
      { id: 'c', name: 'Carol', isBot: true, connected: true },
    ],
    teams: [
      { id: 0, members: ['a', 'c'] },
      { id: 1, members: ['b'] },
    ],
    ...overrides,
  };
}

test('cancelLobbyCleanup clears a scheduled timer and nulls the handle', () => {
  const cleared = [];
  const fakeClear = (h) => cleared.push(h);
  const player = { _lobbyCleanup: 'handle-42' };
  const result = cancelLobbyCleanup(player, fakeClear);
  assert.equal(result, true);
  assert.deepEqual(cleared, ['handle-42']);
  assert.equal(player._lobbyCleanup, null);
});

test('cancelLobbyCleanup is a no-op when no timer is scheduled', () => {
  const cleared = [];
  const player = { _lobbyCleanup: null };
  assert.equal(cancelLobbyCleanup(player, (h) => cleared.push(h)), false);
  assert.equal(cleared.length, 0);
});

test('removePlayerFromLobby drops the player from the roster', () => {
  const room = makeRoom();
  const removed = removePlayerFromLobby(room, 'b');
  assert.equal(removed.name, 'Bob');
  assert.deepEqual(room.players.map((p) => p.id), ['a', 'c']);
});

test('removePlayerFromLobby cancels the target player\'s pending _lobbyCleanup timer', () => {
  // Regression: prior kick handler did NOT clear the timer, so 30s later
  // the timer fired against a stale room state and printed "X timed out."
  // for an already-kicked player.
  const cleared = [];
  const room = makeRoom();
  room.players[1]._lobbyCleanup = 'timer-b';
  removePlayerFromLobby(room, 'b', (h) => cleared.push(h));
  assert.deepEqual(cleared, ['timer-b'], 'pending cleanup timer must be cancelled on removal');
});

test('removePlayerFromLobby returns null when the player id is not in the room', () => {
  const room = makeRoom();
  const before = room.players.length;
  assert.equal(removePlayerFromLobby(room, 'ghost'), null);
  assert.equal(room.players.length, before, 'unrelated players are untouched');
});

test('removePlayerFromLobby purges the player from every team\'s member list', () => {
  const room = makeRoom();
  removePlayerFromLobby(room, 'a');
  assert.deepEqual(room.teams[0].members, ['c']);
  assert.deepEqual(room.teams[1].members, ['b']);
});

test('removePlayerFromLobby reassigns the host when the host leaves', () => {
  const room = makeRoom();
  removePlayerFromLobby(room, 'a'); // Alice is host
  assert.equal(room.hostId, 'b', 'next connected human takes over');
});

test('removePlayerFromLobby prefers a connected human over a bot when reassigning host', () => {
  const room = makeRoom({
    hostId: 'a',
    players: [
      { id: 'a', name: 'Alice', isBot: false, connected: true },
      { id: 'bot1', name: 'Botty', isBot: true, connected: true },
      { id: 'b', name: 'Bob', isBot: false, connected: true },
    ],
  });
  removePlayerFromLobby(room, 'a');
  assert.equal(room.hostId, 'b', 'bots are never promoted to host');
});

test('removePlayerFromLobby leaves hostId null when no eligible successor exists', () => {
  const room = makeRoom({
    hostId: 'a',
    players: [
      { id: 'a', name: 'Alice', isBot: false, connected: true },
      { id: 'bot1', name: 'Botty', isBot: true, connected: true },
    ],
  });
  removePlayerFromLobby(room, 'a');
  assert.equal(room.hostId, null);
});

test('removePlayerFromLobby clamps currentIndex back to 0 when it points off the end', () => {
  const room = makeRoom({ currentIndex: 2 });
  removePlayerFromLobby(room, 'c');
  removePlayerFromLobby(room, 'b');
  assert.equal(room.currentIndex, 0, 'index must stay valid for a subsequent game start');
});

test('removePlayerFromLobby is a safe no-op when called twice for the same id', () => {
  // Timing scenario: kick handler removes the player, then the deferred
  // _lobbyCleanup callback fires and calls removePlayerFromLobby again.
  // The second call must return null and mutate nothing.
  const room = makeRoom();
  room.players[1]._lobbyCleanup = 'timer-b';
  const first = removePlayerFromLobby(room, 'b', () => {});
  const second = removePlayerFromLobby(room, 'b', () => {});
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(room.players.length, 2);
});
