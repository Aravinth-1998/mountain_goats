const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resetForNewGame, createBonusTokens, createPlaceholderMountains } = require('../../game/core/state');
const { makeRoom, makePlayer } = require('../helpers/fixtures');
const { BONUS_DEFS, MOUNTAIN_DEFS } = require('../../game/core/constants');

test('createPlaceholderMountains returns 6 mountains with 4-player chip counts', () => {
  const mountains = createPlaceholderMountains();
  assert.equal(mountains.length, 6);
  assert.equal(mountains[0].value, 5);
  assert.equal(mountains[1].value, 6);
  assert.equal(mountains[2].value, 7);
  assert.equal(mountains[3].value, 8);
  assert.equal(mountains[4].value, 9);
  assert.equal(mountains[5].value, 10);
  assert.equal(mountains[0].height, 4);
  assert.equal(mountains[2].height, 3);
  assert.equal(mountains[4].height, 2);
  // 4 players => no removal, chips === fullStack
  assert.equal(mountains[0].chips, 12);
  assert.equal(mountains[1].chips, 11);
  assert.equal(mountains[2].chips, 10);
  assert.equal(mountains[3].chips, 9);
  assert.equal(mountains[4].chips, 8);
  assert.equal(mountains[5].chips, 7);
});

test('createBonusTokens returns a copy of BONUS_DEFS', () => {
  const tokens = createBonusTokens();
  assert.deepStrictEqual(tokens, BONUS_DEFS);
  assert.notEqual(tokens, BONUS_DEFS);
});

test('resetForNewGame zeros all player positions and collected', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0].pos = [3, 2, 1, 4, 2, 1];
  room.players[0].collected = [5, 3, 0, 0, 1, 2];
  room.players[1].pos = [1, 1, 1, 1, 1, 1];
  room.players[1].collected = [2, 2, 2, 2, 2, 2];
  resetForNewGame(room);
  room.players.forEach((p) => {
    p.pos.forEach((v) => assert.equal(v, 0));
    p.collected.forEach((v) => assert.equal(v, 0));
  });
});

test('resetForNewGame clears player bonus arrays and turn counters', () => {
  const room = makeRoom({ playerCount: 2 });
  room.players[0].bonus = [15];
  room.players[0].turns = 5;
  room.players[1].bonus = [12, 9];
  room.players[1].turns = 7;
  resetForNewGame(room);
  room.players.forEach((p) => {
    assert.deepStrictEqual(p.bonus, []);
    assert.equal(p.turns, 0);
  });
});

test('resetForNewGame resets board state fields', () => {
  const room = makeRoom({ playerCount: 2 });
  room.lastRound = true;
  room.endReason = 'empty';
  room.finished = true;
  room.winnerId = 'p0';
  room.winnerPlayerIds = ['p0'];
  room.winnerTeamId = 1;
  room.currentIndex = 3;
  room.dice = [1, 2, 3, 4];
  room.diceUsed = [true, false];
  room.adjustable = [{ idx: 0 }];
  room.rolled = true;
  room.startedAt = Date.now();
  resetForNewGame(room);
  assert.equal(room.lastRound, false);
  assert.equal(room.endReason, null);
  assert.equal(room.finished, false);
  assert.equal(room.winnerId, null);
  assert.deepStrictEqual(room.winnerPlayerIds, []);
  assert.equal(room.winnerTeamId, null);
  assert.equal(room.currentIndex, 0);
  assert.equal(room.dice, null);
  assert.deepStrictEqual(room.diceUsed, []);
  assert.deepStrictEqual(room.adjustable, []);
  assert.equal(room.rolled, false);
  assert.equal(room.startedAt, null);
});

test('resetForNewGame scales mountain chips by connected player count', () => {
  const room = makeRoom({ playerCount: 4 });
  // Mark only 2 as connected
  room.players[2].connected = false;
  room.players[3].connected = false;
  resetForNewGame(room);
  // 2 connected => removal = max(0, 4-2) = 2
  assert.equal(room.mountains[0].chips, 10);
  assert.equal(room.mountains[5].chips, 5);
});

test('resetForNewGame uses total player count when none are connected', () => {
  const room = makeRoom({ playerCount: 3 });
  room.players.forEach((p) => { p.connected = false; });
  resetForNewGame(room);
  // 0 connected => fallback to total count 3 => removal = max(0, 4-3) = 1
  assert.equal(room.mountains[0].chips, 11);
  assert.equal(room.mountains[5].chips, 6);
});

test('resetForNewGame rebuilds mountains fresh each call', () => {
  const room = makeRoom({ playerCount: 2 });
  resetForNewGame(room);
  const first = room.mountains;
  resetForNewGame(room);
  const second = room.mountains;
  assert.notEqual(first, second);
});

test('resetForNewGame with 3 players removes 1 chip per mountain', () => {
  const room = makeRoom({ playerCount: 3 });
  resetForNewGame(room);
  // removal = max(0, 4-3) = 1
  assert.equal(room.mountains[0].chips, 11);
  assert.equal(room.mountains[1].chips, 10);
  assert.equal(room.mountains[5].chips, 6);
});

test('resetForNewGame with 4+ players uses full stack', () => {
  const room = makeRoom({ playerCount: 4 });
  resetForNewGame(room);
  // removal = max(0, 4-4) = 0
  assert.equal(room.mountains[0].chips, 12);
  assert.equal(room.mountains[1].chips, 11);
  assert.equal(room.mountains[5].chips, 7);
});
