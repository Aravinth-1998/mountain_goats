const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreGroup } = require('../../game/ai/bot-heuristics');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('scoreGroup penalizes using more dice', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  bot.pos[0] = 3; // stepsLeft === 1 for mountain 0 (height 4)

  const oneDie = scoreGroup(room, bot, [0], 0);
  const twoDice = scoreGroup(room, bot, [0, 1], 0);
  assert.ok(Math.abs((oneDie - twoDice) - 0.8) < 1e-10);
});

test('scoreGroup values empty mountain bump opportunity', () => {
  const room = makeRoom({ playerCount: 4 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  const opp1 = makePlayer({ id: 'opp1' });
  const opp2 = makePlayer({ id: 'opp2' });
  room.players.push(bot);
  room.mountains[0].chips = 0;
  bot.pos[0] = 3; // stepsLeft === 1 for mountain 0 (height 4)
  opp1.pos[0] = 4; // on top
  opp2.pos[0] = 4; // on top
  room.players[1] = opp1;
  room.players[2] = opp2;

  const score = scoreGroup(room, bot, [0], 0);
  // value = 2 * 2 = 4, minus dice penalty (1-1)*0.8 = 0
  assert.equal(score, 4);
});

test('scoreGroup returns -Infinity for empty mountain when at summit', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  room.mountains[0].chips = 0;
  bot.pos[0] = 4; // at top (height 4)

  const score = scoreGroup(room, bot, [0], 0);
  assert.equal(score, -Infinity);
});

test('scoreGroup returns -Infinity for empty mountain far from summit', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  room.mountains[0].chips = 0;
  bot.pos[0] = 0;

  const score = scoreGroup(room, bot, [0], 0);
  assert.equal(score, -Infinity);
});

test('scoreGroup adds urgency bonus when few chips remain on summit', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  bot.pos[0] = 4; // at top (height 4)

  room.mountains[0].chips = 10;
  const scoreManyChips = scoreGroup(room, bot, [0], 0);

  room.mountains[0].chips = 1;
  const scoreFewChips = scoreGroup(room, bot, [0], 0);

  // chips=1: bonus = max(0, 3-1) = 2; chips=10: bonus = max(0, 3-10) = 0
  assert.ok(scoreFewChips > scoreManyChips);
  assert.equal(scoreFewChips - scoreManyChips, 2);
});

test('scoreGroup adds urgency bonus when one step from summit and chips scarce', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  bot.pos[0] = 3; // stepsLeft === 1 for mountain 0 (height 4)

  room.mountains[0].chips = 10;
  const scoreManyChips = scoreGroup(room, bot, [0], 0);

  room.mountains[0].chips = 2;
  const scoreFewChips = scoreGroup(room, bot, [0], 0);

  // chips=2: bonus = max(0, 4-2)*1.5 = 3; chips=10: bonus = max(0, 4-10)*1.5 = 0
  assert.ok(scoreFewChips > scoreManyChips);
  assert.equal(scoreFewChips - scoreManyChips, 3);
});

test('scoreGroup values progress proportional to 1/stepsLeft', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  room.mountains[0].chips = 10; // high so no scarcity bonus

  bot.pos[0] = 1; // stepsLeft = 3 for mountain 0 (height 4)
  const scoreAt1 = scoreGroup(room, bot, [0], 0);

  bot.pos[0] = 2; // stepsLeft = 2
  const scoreAt2 = scoreGroup(room, bot, [0], 0);

  assert.ok(scoreAt2 > scoreAt1);
});

test('scoreGroup adds bonus value when collecting would complete a set', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  // mi=5 is mountain value 10, height 2
  bot.pos[5] = 2; // at top

  // Collecting mi=5 completes a set (all collected >= 1)
  bot.collected = [1, 1, 1, 1, 1, 0];
  const scoreWithSet = scoreGroup(room, bot, [0], 5);

  // Not completing a set
  bot.collected = [0, 1, 1, 1, 1, 0];
  const scoreWithoutSet = scoreGroup(room, bot, [0], 5);

  // bonusValue = 15 (first bonus token) when set completes
  assert.ok(scoreWithSet > scoreWithoutSet);
  assert.equal(scoreWithSet - scoreWithoutSet, 15);
});

test('scoreGroup ignores teammates when counting opponents on top (team mode)', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // Teams: p0+p2 = team 0, p1+p3 = team 1
  const bot = room.players[0];
  bot.isBot = true;
  bot.pos[0] = 3; // stepsLeft === 1 for mountain 0 (height 4)

  const teammate = room.players[2]; // same team as bot (team 0)
  const opponent = room.players[1]; // team 1
  teammate.pos[0] = 4; // on top
  opponent.pos[0] = 4; // on top
  room.mountains[0].chips = 0;

  const score = scoreGroup(room, bot, [0], 0);
  // oppsOnTop should be 1 (only opponent p1), teammate p2 excluded
  // value = 2 * 1 = 2, minus (1-1)*0.8 = 0
  assert.equal(score, 2);
});

test('scoreGroup low-chip bonus for multi-step climb', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.players.push(bot);
  // mountain 0: value 5, height 4
  bot.pos[0] = 0; // stepsLeft = 4

  room.mountains[0].chips = 2; // <= 3, triggers +1.5 bonus
  const scoreWithBonus = scoreGroup(room, bot, [0], 0);

  room.mountains[0].chips = 10; // > 3, no bonus
  const scoreWithoutBonus = scoreGroup(room, bot, [0], 0);

  assert.equal(scoreWithBonus - scoreWithoutBonus, 1.5);
});
