const { test } = require('node:test');
const assert = require('node:assert/strict');
const { advanceTurnState, isLastRoundComplete } = require('../../game/actions/turn');

function makeRoom(overrides = {}) {
  return {
    currentIndex: 0,
    rolled: true,
    dice: [1, 2, 3, 4],
    diceUsed: [true, false, false, false],
    adjustable: [0],
    lastRound: false,
    finished: false,
    players: [
      { id: 'a', connected: true, isBot: false, turns: 0 },
      { id: 'b', connected: true, isBot: false, turns: 0 },
      { id: 'c', connected: true, isBot: false, turns: 0 },
    ],
    ...overrides,
  };
}

test('advanceTurnState increments finishing player turns and clears roll state', () => {
  const room = makeRoom();
  advanceTurnState(room);
  assert.equal(room.players[0].turns, 1);
  assert.equal(room.rolled, false);
  assert.equal(room.dice, null);
  assert.deepEqual(room.diceUsed, []);
  assert.deepEqual(room.adjustable, []);
});

test('advanceTurnState moves currentIndex forward by one and wraps at the end', () => {
  const room = makeRoom({ currentIndex: 0 });
  advanceTurnState(room);
  assert.equal(room.currentIndex, 1);
  advanceTurnState(room);
  assert.equal(room.currentIndex, 2);
  advanceTurnState(room);
  assert.equal(room.currentIndex, 0, 'wraps from last seat back to first');
});

test('advanceTurnState never skips a disconnected non-bot seat', () => {
  // Regression: the prior dead loop broke on the first iteration, so the
  // behavior was already advance-by-one. This pins that behavior: disconnected
  // humans still get the turn (a bot substitutes downstream), they do NOT
  // get their turn silently forfeited.
  const room = makeRoom({
    currentIndex: 0,
    players: [
      { id: 'a', connected: true, isBot: false, turns: 0 },
      { id: 'b', connected: false, isBot: false, turns: 0 },
      { id: 'c', connected: true, isBot: false, turns: 0 },
    ],
  });
  advanceTurnState(room);
  assert.equal(room.currentIndex, 1, 'disconnected human is next; caller substitutes bot');
});

test('advanceTurnState is a no-op when the roster is empty', () => {
  const room = makeRoom({ currentIndex: 0, players: [] });
  advanceTurnState(room);
  assert.equal(room.currentIndex, 0);
  assert.equal(room.rolled, true, 'no players → nothing to advance');
});

test('advanceTurnState with a single player wraps back to the same seat', () => {
  const room = makeRoom({
    currentIndex: 0,
    players: [{ id: 'solo', connected: true, isBot: false, turns: 0 }],
  });
  advanceTurnState(room);
  assert.equal(room.currentIndex, 0);
  assert.equal(room.players[0].turns, 1);
});

test('isLastRoundComplete returns false when lastRound flag is off', () => {
  const room = makeRoom({ lastRound: false });
  room.players.forEach((p) => (p.turns = 3));
  assert.equal(isLastRoundComplete(room), false);
});

test('isLastRoundComplete returns false while turn counts differ', () => {
  const room = makeRoom({ lastRound: true });
  room.players[0].turns = 3;
  room.players[1].turns = 3;
  room.players[2].turns = 2;
  assert.equal(isLastRoundComplete(room), false);
});

test('isLastRoundComplete returns true once every connected player has equal turns', () => {
  const room = makeRoom({ lastRound: true });
  room.players.forEach((p) => (p.turns = 4));
  assert.equal(isLastRoundComplete(room), true);
});

test('isLastRoundComplete ignores disconnected players when comparing turn counts', () => {
  const room = makeRoom({ lastRound: true });
  room.players[0].turns = 5;
  room.players[1].turns = 5;
  room.players[2].turns = 2;
  room.players[2].connected = false;
  assert.equal(isLastRoundComplete(room), true, 'disconnected mid-round should not block endgame');
});

test('isLastRoundComplete returns false when the game is already finished', () => {
  const room = makeRoom({ lastRound: true, finished: true });
  room.players.forEach((p) => (p.turns = 4));
  assert.equal(isLastRoundComplete(room), false);
});
