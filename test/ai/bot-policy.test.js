const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldBotPlay } = require('../../game/ai/bot-policy');
const { makeRoom, makePlayer } = require('../helpers/fixtures');

function roomWithCurrent(player, { started = true, finished = false } = {}) {
  const room = makeRoom({ playerCount: 2 });
  room.started = started;
  room.finished = finished;
  room.players[0] = player;
  room.currentIndex = 0;
  return room;
}

test('shouldBotPlay is true when current player is a bot', () => {
  const room = roomWithCurrent(makePlayer({ id: 'bot', isBot: true }));
  assert.equal(shouldBotPlay(room), true);
});

test('shouldBotPlay is false when connected human is current', () => {
  const room = roomWithCurrent(makePlayer({ id: 'p0', isBot: false, connected: true }));
  assert.equal(shouldBotPlay(room), false);
});

test('shouldBotPlay is true when disconnected human is current', () => {
  const player = makePlayer({ id: 'p0', isBot: false });
  player.connected = false;
  const room = roomWithCurrent(player);
  assert.equal(shouldBotPlay(room), true);
});

test('shouldBotPlay is false when game is not started or is finished', () => {
  const bot = makePlayer({ id: 'bot', isBot: true });
  assert.equal(shouldBotPlay(roomWithCurrent(bot, { started: false })), false);
  assert.equal(shouldBotPlay(roomWithCurrent(bot, { finished: true })), false);
});

test('shouldBotPlay is true when autoPlayTurn is set for connected human', () => {
  const room = roomWithCurrent(makePlayer({ id: 'p0', isBot: false, connected: true }));
  room.autoPlayTurn = true;
  assert.equal(shouldBotPlay(room), true);
});

test('shouldBotPlay is false when autoPlayTurn is false for connected human', () => {
  const room = roomWithCurrent(makePlayer({ id: 'p0', isBot: false, connected: true }));
  room.autoPlayTurn = false;
  assert.equal(shouldBotPlay(room), false);
});
