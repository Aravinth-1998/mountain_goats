const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkEndgameTrigger, awardBonus, takeToken } = require('../../game/actions/climb-helpers');
const { makeRoom, makePlayer } = require('../helpers/fixtures');
const { makeStartedRoom, collectLog, noopLog } = require('../helpers/game-flow');

// --- checkEndgameTrigger ---

test('does not trigger when fewer than 3 mountains are empty', () => {
  const room = makeRoom({ playerCount: 2 });
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;

  checkEndgameTrigger(room);

  assert.equal(room.lastRound, false);
  assert.equal(room.endReason, null);
});

test('triggers on exactly 3 empty mountains', () => {
  const room = makeRoom({ playerCount: 2 });
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;
  room.mountains[2].chips = 0;

  checkEndgameTrigger(room);

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'empty');
});

test('triggers on all bonus tokens gone', () => {
  const room = makeRoom({ playerCount: 2 });
  room.bonusTokens = [];

  checkEndgameTrigger(room);

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'bonus');
});

test('is idempotent when lastRound already true', () => {
  const room = makeRoom({ playerCount: 2 });
  room.lastRound = true;
  room.endReason = 'empty';
  room.bonusTokens = [];

  checkEndgameTrigger(room);

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'empty');
});

test('bonus reason takes priority over empty when both true simultaneously', () => {
  const room = makeRoom({ playerCount: 2 });
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;
  room.mountains[2].chips = 0;
  room.bonusTokens = [];

  checkEndgameTrigger(room);

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'bonus');
});

test('logs the trigger reason', () => {
  const room = makeRoom({ playerCount: 2 });
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;
  room.mountains[2].chips = 0;
  const { log, messages } = collectLog();

  checkEndgameTrigger(room, log);

  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('3 mountains emptied'));
  assert.ok(messages[0].includes('Final round'));
});

// --- awardBonus ---

test('awards bonus when player completes a full set', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  player.collected = [1, 1, 1, 1, 1, 1];

  awardBonus(room, player);

  assert.deepEqual(player.bonus, [15]);
  assert.equal(room.bonusTokens.length, 3);
});

test('awards multiple bonuses for multiple new sets', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  player.collected = [2, 2, 2, 2, 2, 2];
  player.bonus = [];

  awardBonus(room, player);

  assert.deepEqual(player.bonus, [15, 12]);
  assert.equal(room.bonusTokens.length, 2);
});

test('does not award when no complete set', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  player.collected = [1, 1, 1, 0, 1, 1];

  awardBonus(room, player);

  assert.deepEqual(player.bonus, []);
});

test('stops awarding when bonus tokens run out', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  player.collected = [3, 3, 3, 3, 3, 3];
  room.bonusTokens = [6];

  awardBonus(room, player);

  assert.deepEqual(player.bonus, [6]);
  assert.equal(room.bonusTokens.length, 0);
});

test('logs bonus award message', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  player.collected = [1, 1, 1, 1, 1, 1];
  const { log, messages } = collectLog();

  awardBonus(room, player, log);

  assert.equal(messages.length, 1);
  assert.ok(messages[0].includes('15p Bonus Token'));
  assert.ok(messages[0].includes(player.name));
});

// --- takeToken ---

test('decrements mountain chips and increments player collected', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  const chipsBefore = room.mountains[0].chips;

  takeToken(room, player, 0);

  assert.equal(room.mountains[0].chips, chipsBefore - 1);
  assert.equal(player.collected[0], 1);
});

test('does nothing when mountain has no chips', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  room.mountains[0].chips = 0;

  takeToken(room, player, 0);

  assert.equal(player.collected[0], 0);
  assert.equal(room.mountains[0].chips, 0);
});

test('triggers bonus award after collecting', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  player.collected = [0, 1, 1, 1, 1, 1];

  takeToken(room, player, 0);

  assert.equal(player.collected[0], 1);
  assert.deepEqual(player.bonus, [15]);
});

test('triggers endgame after token collection empties third mountain', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;
  room.mountains[2].chips = 1;

  takeToken(room, player, 2);

  assert.equal(room.mountains[2].chips, 0);
  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'empty');
});

test('chains takeToken → awardBonus → checkEndgameTrigger correctly', () => {
  const room = makeRoom({ playerCount: 2 });
  const player = room.players[0];
  // Player needs 1 more token on mountain 0 to complete a set
  player.collected = [0, 1, 1, 1, 1, 1];
  // Only 1 bonus token left — claiming it triggers endgame via bonus path
  room.bonusTokens = [6];
  const { log, messages } = collectLog();

  takeToken(room, player, 0, log);

  assert.equal(player.collected[0], 1);
  assert.deepEqual(player.bonus, [6]);
  assert.equal(room.bonusTokens.length, 0);
  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'bonus');
  // Should have both a bonus message and an endgame message
  assert.ok(messages.some((m) => m.includes('Bonus Token')));
  assert.ok(messages.some((m) => m.includes('Final round')));
});
