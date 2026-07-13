const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scoreGroup } = require('../../game/ai/bot-heuristics');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

test('scoreGroup returns -Infinity for empty mountain with no bump opportunity', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  room.mountains[0].chips = 0;
  bot.pos[0] = 0;

  const score = scoreGroup(room, bot, [0], 0);
  assert.equal(score, -Infinity);
});

test('scoreGroup rewards reaching summit with tokens available', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  bot.pos[0] = 3;

  const score = scoreGroup(room, bot, [0], 0);
  assert.ok(score > 0);
});

test('scoreGroup rewards harvesting on summit', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  bot.pos[0] = 4;

  const score = scoreGroup(room, bot, [0], 0);
  assert.ok(score >= room.mountains[0].value);
});

test('scoreGroup values reaching summit higher when opponent is on top', () => {
  const room = makeRoom({ playerCount: 2 });
  const bot = makePlayer({ id: 'bot', isBot: true });
  const opponent = makePlayer({ id: 'opp', isBot: false });
  room.players[1] = opponent;
  bot.pos[0] = 3;
  opponent.pos[0] = 4;

  const withOpponent = scoreGroup(room, bot, [0], 0);
  opponent.pos[0] = 0;
  const withoutOpponent = scoreGroup(room, bot, [0], 0);
  assert.ok(withOpponent > withoutOpponent);
});
