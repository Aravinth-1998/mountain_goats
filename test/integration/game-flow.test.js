const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyClimb, checkEndgameTrigger } = require('../../game/actions/climb');
const { scoreOf } = require('../../game/scoring/scoring');
const { resolveWinners, buildMatchStatUpdates } = require('../../game/match/winners');
const { botChooseGroup } = require('../../game/ai/bot-choose');
const { makeStartedRoom, noopLog, collectLog } = require('../helpers/game-flow');

test('standard climb awards token and increases score', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const player = room.players[0];
  player.pos[0] = 3;

  applyClimb(room, player, 0, noopLog());

  assert.equal(player.pos[0], 4);
  assert.equal(player.collected[0], 1);
  assert.equal(scoreOf(room, player), 5);
});

test('endgame trigger then resolve winner', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  room.players[0].collected = [2, 0, 0, 0, 0, 0];
  room.players[1].collected = [0, 1, 0, 0, 0, 0];
  room.mountains[0].chips = 0;
  room.mountains[1].chips = 0;
  room.mountains[2].chips = 0;

  const { log, messages } = collectLog();
  checkEndgameTrigger(room, log);

  assert.equal(room.lastRound, true);
  assert.equal(room.endReason, 'empty');
  assert.ok(messages.some((m) => m.includes('3 mountains emptied')));

  resolveWinners(room);
  assert.equal(room.winnerId, 'p0');
  assert.equal(room.finished, true);
});

test('5-player standard game yields two winners', () => {
  const room = makeStartedRoom({ playerCount: 5 });
  room.players[0].collected = [3, 0, 0, 0, 0, 0];
  room.players[1].collected = [2, 0, 0, 0, 0, 0];
  room.players[2].collected = [1, 0, 0, 0, 0, 0];
  room.players[3].collected = [0, 1, 0, 0, 0, 0];
  room.players[4].collected = [0, 0, 1, 0, 0, 0];

  resolveWinners(room);

  assert.equal(room.winnerPlayerIds.length, 2);
  assert.equal(room.winnerId, 'p0');
  assert.ok(room.winnerPlayerIds.includes('p1'));
});

test('8-player standard game yields three winners', () => {
  const room = makeStartedRoom({ playerCount: 8 });
  room.players[0].collected = [4, 0, 0, 0, 0, 0];
  room.players[1].collected = [3, 0, 0, 0, 0, 0];
  room.players[2].collected = [2, 0, 0, 0, 0, 0];
  room.players[3].collected = [1, 0, 0, 0, 0, 0];
  room.players[4].collected = [0, 1, 0, 0, 0, 0];
  room.players[5].collected = [0, 0, 1, 0, 0, 0];
  room.players[6].collected = [0, 0, 0, 1, 0, 0];
  room.players[7].collected = [0, 0, 0, 0, 1, 0];

  resolveWinners(room);

  assert.equal(room.winnerPlayerIds.length, 3);
  assert.equal(room.winnerId, 'p0');
  assert.ok(room.winnerPlayerIds.includes('p1'));
  assert.ok(room.winnerPlayerIds.includes('p2'));
});

test('team mode match stats for winning team', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  room.players[0].authUserId = 'user-a';
  room.players[1].authUserId = 'user-b';
  room.players[2].authUserId = 'user-c';
  room.players[0].collected = [2, 0, 0, 0, 0, 0];
  room.players[2].collected = [1, 0, 0, 0, 0, 0];
  room.players[1].collected = [0, 1, 0, 0, 0, 0];
  room.players[3].collected = [0, 0, 1, 0, 0, 0];

  resolveWinners(room);
  const updates = buildMatchStatUpdates(room);

  const userA = updates.find((u) => u.userId === 'user-a');
  const userB = updates.find((u) => u.userId === 'user-b');
  const userC = updates.find((u) => u.userId === 'user-c');
  assert.equal(userA.won, true);
  assert.equal(userC.won, true);
  assert.equal(userB.won, false);
});

test('bot choose group then climb applies a valid move', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const bot = room.players[0];
  bot.isBot = true;
  bot.pos[0] = 3;
  room.dice = [5, 5, 5, 5];
  room.diceUsed = [false, false, false, false];

  const group = botChooseGroup(room, bot);
  assert.ok(group);
  applyClimb(room, bot, group.mountainIndex, noopLog());

  assert.ok(bot.collected.some((c) => c > 0));
  assert.ok(scoreOf(room, bot) > 0);
});
