const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  botChooseGroup,
  simulateGreedyBotTurn,
  botOptimizeAdjustableDice,
} = require('../../game/ai/bot-choose');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('botChooseGroup picks a valid mountain for four 5s', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.dice = [5, 5, 5, 5];
  room.diceUsed = [false, false, false, false];

  const group = botChooseGroup(room, bot);
  assert.ok(group);
  assert.ok(group.score > -Infinity);
  assert.ok(group.mountainIndex === 0 || group.mountainIndex === 5);
});

test('botChooseGroup returns null when no valid sum 5-10', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.dice = [1, 1, 1, 1];
  room.diceUsed = [false, false, false, false];

  assert.equal(botChooseGroup(room, bot), null);
});

test('botChooseGroup respects diceUsed flags', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.dice = [5, 5, 5, 5];
  room.diceUsed = [true, true, true, true];

  assert.equal(botChooseGroup(room, bot), null);
});

test('simulateGreedyBotTurn returns positive score for favorable dice', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  bot.pos[0] = 3;

  const total = simulateGreedyBotTurn(room, bot, [5, 5, 5, 5]);
  assert.ok(total > 0);
});

test('botOptimizeAdjustableDice updates dice, clears adjustable, and logs changes', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  bot.pos[0] = 3;
  room.dice = [1, 1, 2, 3];
  room.adjustable = [0, 1];
  const logs = [];

  botOptimizeAdjustableDice(room, bot, 'Bot', (msg) => logs.push(msg));

  assert.deepEqual(room.adjustable, []);
  assert.ok(room.dice.some((face) => face !== 1));
  assert.ok(logs.length > 0);
  assert.match(logs[0], /re-faced dice to/);
});
