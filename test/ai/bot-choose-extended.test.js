const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  botChooseGroup,
  simulateGreedyBotTurn,
  botOptimizeAdjustableDice,
} = require('../../game/ai/bot-choose');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('botChooseGroup picks best mountain when multiple valid groups exist', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  room.dice = [5, 5, 5, 5];
  room.diceUsed = [false, false, false, false];
  // Bot is one step from summit on mountain 0 (value 5, height 4)
  bot.pos[0] = 3;
  // Bot is far from summit on mountain 5 (value 10, height 2)
  bot.pos[5] = 0;

  const group = botChooseGroup(room, bot);
  assert.ok(group);
  // Should prefer mountain 0 (close to summit) over mountain 5 (far)
  assert.equal(group.mountainIndex, 0);
});

test('botChooseGroup handles dice that sum to multiple valid mountains', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  room.dice = [3, 4, 2, 1];
  room.diceUsed = [false, false, false, false];

  const group = botChooseGroup(room, bot);
  assert.ok(group);
  assert.ok(group.mountainIndex >= 0 && group.mountainIndex <= 5);
  assert.ok(group.score > -Infinity);
});

test('botChooseGroup prefers fewer dice for same mountain when close to summit', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  // dice: 5 alone targets mountain 0 (value 5), 3+2 also targets mountain 0
  room.dice = [5, 3, 2, 1];
  room.diceUsed = [false, false, false, false];
  bot.pos[0] = 3; // one step from summit on mountain 0

  const group = botChooseGroup(room, bot);
  assert.ok(group);
  assert.equal(group.mountainIndex, 0);
  // Should pick the single-die option (index 0) over two-dice (indices 1,2)
  assert.equal(group.indices.length, 1);
  assert.deepEqual(group.indices, [0]);
});

test('simulateGreedyBotTurn uses all dice when possible', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  // dice=[5,5,5,5]: two groups of 5+5=10
  const total = simulateGreedyBotTurn(room, bot, [5, 5, 5, 5]);
  assert.ok(total > 0);
});

test('simulateGreedyBotTurn returns 0 when no valid groups exist', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  // dice=[1,1,1,1]: max sum is 4, below minimum 5
  const total = simulateGreedyBotTurn(room, bot, [1, 1, 1, 1]);
  assert.equal(total, 0);
});

test('botOptimizeAdjustableDice clears adjustable even when no change needed', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  bot.pos[0] = 3;
  // dice already good: 5 targets mountain 0 where bot is near summit
  room.dice = [5, 5, 5, 5];
  room.adjustable = [0];
  const logs = [];

  botOptimizeAdjustableDice(room, bot, 'Bot', (msg) => logs.push(msg));

  assert.deepEqual(room.adjustable, []);
});

test('botChooseGroup with partially used dice finds groups from remaining', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  room.dice = [5, 5, 3, 7];
  room.diceUsed = [true, false, false, false];

  const group = botChooseGroup(room, bot);
  assert.ok(group);
  // Index 0 is used, so it should not appear in the chosen indices
  assert.ok(!group.indices.includes(0));
});

test('botChooseGroup skips mountains where score is -Infinity', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  // Set all mountains to chips=0, bot far from all summits
  room.mountains.forEach((m) => { m.chips = 0; });
  bot.pos = [0, 0, 0, 0, 0, 0];
  room.dice = [5, 5, 5, 5];
  room.diceUsed = [false, false, false, false];

  const group = botChooseGroup(room, bot);
  assert.equal(group, null);
});
