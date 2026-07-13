const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveFeedbackEvents, deriveHapticEvents, parseLogEntry } = require('../../public/js/feedback-events');

const PLAYERS = [
  { id: 'p0', name: 'Alice' },
  { id: 'p1', name: 'Bob' },
];

function makeState(overrides) {
  return {
    log: [],
    players: PLAYERS,
    rolled: false,
    finished: false,
    lastRound: false,
    currentPlayerId: 'p0',
    ...overrides,
  };
}

test('deriveFeedbackEvents returns empty when prev is null', () => {
  const next = makeState({ log: [{ t: 100, text: 'Alice rolled 1, 2, 3, 4.' }] });
  assert.deepEqual(deriveFeedbackEvents(null, next, 'p0'), []);
});

test('deriveHapticEvents alias matches deriveFeedbackEvents', () => {
  const prev = makeState({ log: [{ t: 100, text: 'Lobby message.' }] });
  const next = makeState({
    log: [
      { t: 100, text: 'Lobby message.' },
      { t: 200, text: 'Alice rolled 1, 2, 3, 4.' },
    ],
    rolled: true,
  });
  assert.deepEqual(deriveHapticEvents(prev, next, 'p0'), deriveFeedbackEvents(prev, next, 'p0'));
});

test('deriveFeedbackEvents detects new dice roll from log', () => {
  const prev = makeState({ log: [{ t: 100, text: 'Lobby message.' }] });
  const next = makeState({
    log: [
      { t: 100, text: 'Lobby message.' },
      { t: 200, text: 'Alice rolled 1, 2, 3, 4.' },
    ],
    rolled: true,
  });
  const events = deriveFeedbackEvents(prev, next, 'p0');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'dice_roll');
  assert.equal(events[0].actorId, 'p0');
  assert.equal(events[0].self, true);
});

test('deriveFeedbackEvents detects bump victim', () => {
  const prev = makeState({ log: [{ t: 100, text: 'Started.' }] });
  const next = makeState({
    log: [
      { t: 100, text: 'Started.' },
      { t: 300, text: "Bob's goat was bumped off the top of Mountain 7!" },
    ],
  });
  const events = deriveFeedbackEvents(prev, next, 'p1');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'bump');
  assert.equal(events[0].victimId, 'p1');
  assert.equal(events[0].self, true);
});

test('deriveFeedbackEvents uses your_turn fallback when turn changes', () => {
  const prev = makeState({ currentPlayerId: 'p0' });
  const next = makeState({ currentPlayerId: 'p1' });
  const events = deriveFeedbackEvents(prev, next, 'p1');
  assert.ok(events.some((event) => event.type === 'your_turn'));
});

test('deriveFeedbackEvents uses game_end fallback when finished flips', () => {
  const prev = makeState({ finished: false });
  const next = makeState({ finished: true });
  const events = deriveFeedbackEvents(prev, next, 'p0');
  assert.ok(events.some((event) => event.type === 'game_end'));
});

test('deriveFeedbackEvents does not replay old log entries on reconnect-style snapshot', () => {
  const prev = makeState({
    log: [{ t: 100, text: 'Alice rolled 1, 2, 3, 4.' }],
    rolled: true,
  });
  const next = makeState({
    log: [{ t: 100, text: 'Alice rolled 1, 2, 3, 4.' }],
    rolled: true,
  });
  assert.deepEqual(deriveFeedbackEvents(prev, next, 'p0'), []);
});

test('parseLogEntry detects bonus token claim', () => {
  const event = parseLogEntry('Alice completed a full set and claimed the 15p Bonus Token!', PLAYERS, 'p0');
  assert.equal(event.type, 'bonus');
  assert.equal(event.self, true);
});

test('parseLogEntry detects final round bell', () => {
  const event = parseLogEntry('Final round! (all Bonus Tokens claimed) - everyone gets equal turns.', PLAYERS, 'p0');
  assert.equal(event.type, 'final_round');
});
