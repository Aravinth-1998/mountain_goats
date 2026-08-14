const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyClimb, checkEndgameTrigger } = require('../../game/actions/climb');
const { applyOnesRule, adjustDie } = require('../../game/actions/dice');
const { advanceTurnState, isLastRoundComplete } = require('../../game/actions/turn');
const { scoreOf, topsOf, setsOf, pointsOf, bonusOf } = require('../../game/scoring/scoring');
const { rankedPlayers } = require('../../game/scoring/ranking');
const { resolveWinners, announceWinners, buildMatchStatUpdates } = require('../../game/match/winners');
const { makeStartedRoom, collectLog, noopLog } = require('../helpers/game-flow');

test('full turn cycle: roll → adjust → climb → advance', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];

  // Simulate a roll
  room.dice = [1, 1, 3, 2];
  room.diceUsed = [false, false, false, false];
  room.rolled = true;

  // Apply ones rule — two 1s means index 0 becomes adjustable (all but last)
  applyOnesRule(room);
  assert.ok(room.adjustable.length > 0, 'at least one die should be adjustable');
  assert.ok(room.adjustable.includes(0), 'die 0 should be adjustable');

  // Adjust die 0 to face 5
  const adjusted = adjustDie(room, 0, 5);
  assert.equal(adjusted, true, 'adjustDie should succeed');
  assert.equal(room.dice[0], 5);

  // Climb mountain 0 (value 5) using die 0 (value 5)
  applyClimb(room, p0, 0, noopLog());
  assert.equal(p0.pos[0], 1, 'p0 should have climbed one step on mountain 0');
  room.diceUsed[0] = true;

  // Climb mountain 0 again using die[2]+die[3] = 3+2 = 5
  applyClimb(room, p0, 0, noopLog());
  assert.equal(p0.pos[0], 2, 'p0 should have climbed another step on mountain 0');
  room.diceUsed[2] = true;
  room.diceUsed[3] = true;

  // Advance turn
  advanceTurnState(room);
  assert.equal(p0.turns, 1, 'p0 should have 1 turn completed');
  assert.equal(room.currentIndex, 1, 'current player should advance to index 1');
  assert.equal(room.rolled, false, 'rolled should be reset');
  assert.equal(room.dice, null, 'dice should be cleared');
});

test('full game ending via 3 empty mountains', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];

  // Set mountains 0, 1, 2 to have 1 chip each
  room.mountains[0].chips = 1;
  room.mountains[1].chips = 1;
  room.mountains[2].chips = 1;

  // Put p0 at summit on all 3 (heights: 4, 4, 3)
  p0.pos[0] = room.mountains[0].height;
  p0.pos[1] = room.mountains[1].height;
  p0.pos[2] = room.mountains[2].height;

  const { log, messages } = collectLog();

  // Harvest from mountain 0 — takes last chip, now 0 chips
  applyClimb(room, p0, 0, log);
  assert.equal(p0.collected[0], 1);
  assert.equal(room.mountains[0].chips, 0);
  assert.equal(room.lastRound, false, 'not yet 3 empty mountains');

  // Harvest from mountain 1
  applyClimb(room, p0, 1, log);
  assert.equal(p0.collected[1], 1);
  assert.equal(room.mountains[1].chips, 0);
  assert.equal(room.lastRound, false, 'only 2 empty mountains so far');

  // Harvest from mountain 2 — triggers endgame
  applyClimb(room, p0, 2, log);
  assert.equal(p0.collected[2], 1);
  assert.equal(room.mountains[2].chips, 0);
  assert.equal(room.lastRound, true, 'lastRound triggered after 3 empty mountains');
  assert.equal(room.endReason, 'empty');

  // Equalize turns: both players need same turn count
  room.currentIndex = 0;
  advanceTurnState(room); // p0 turns = 1, currentIndex = 1
  advanceTurnState(room); // p1 turns = 1, currentIndex = 0

  assert.equal(isLastRoundComplete(room), true, 'all players have equal turns');

  resolveWinners(room);
  assert.equal(room.winnerId, 'p0');
  assert.equal(room.finished, true);
});

test('full game ending via bonus tokens depleted', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];

  // Only 1 bonus token left
  room.bonusTokens = [6];

  // p0 has collected 1 of each except mountain 5
  p0.collected = [1, 1, 1, 1, 1, 0];

  // p0 is one step from summit on mountain 5 (index 5, height 2)
  p0.pos[5] = room.mountains[5].height - 1;

  const { log, messages } = collectLog();

  // Climb to summit on mountain 5 — reach top, take token, complete set, claim bonus
  applyClimb(room, p0, 5, log);

  assert.equal(p0.pos[5], room.mountains[5].height, 'p0 reached summit');
  assert.equal(p0.collected[5], 1, 'p0 collected mountain 5 token');
  assert.equal(setsOf(p0), 1, 'p0 has 1 complete set');
  assert.equal(p0.bonus.length, 1, 'p0 received bonus token');
  assert.equal(p0.bonus[0], 6, 'bonus value is 6');
  assert.equal(room.bonusTokens.length, 0, 'all bonus tokens claimed');
  assert.equal(room.lastRound, true, 'lastRound triggered');
  assert.equal(room.endReason, 'bonus');
});

test('tiebreak resolution: score tied, tops break it', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];
  const p1 = room.players[1];

  // Both have score 11: collected [1,1,0,0,0,0] → 5+6 = 11
  p0.collected = [1, 1, 0, 0, 0, 0];
  p1.collected = [1, 1, 0, 0, 0, 0];

  // p0 has 1 summit (mountain 0, height 4)
  p0.pos[0] = room.mountains[0].height;

  // p1 has 2 summits (mountains 0 and 1, heights 4 and 4)
  p1.pos[0] = room.mountains[0].height;
  p1.pos[1] = room.mountains[1].height;

  assert.equal(scoreOf(room, p0), 11);
  assert.equal(scoreOf(room, p1), 11);
  assert.equal(topsOf(room, p0), 1);
  assert.equal(topsOf(room, p1), 2);

  resolveWinners(room);
  assert.equal(room.winnerId, 'p1', 'p1 wins with more summits');
});

test('tiebreak resolution: score and tops tied, highest mountain breaks it', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];
  const p1 = room.players[1];

  // p0: 2 tokens from mountain 0 (value 5) → 10 points, summit on mountain 0
  p0.collected = [2, 0, 0, 0, 0, 0];
  p0.pos[0] = room.mountains[0].height; // summit value 5

  // p1: 1 token from mountain 5 (value 10) → 10 points, summit on mountain 5
  p1.collected = [0, 0, 0, 0, 0, 1];
  p1.pos[5] = room.mountains[5].height; // summit value 10

  assert.equal(scoreOf(room, p0), 10);
  assert.equal(scoreOf(room, p1), 10);
  assert.equal(topsOf(room, p0), 1);
  assert.equal(topsOf(room, p1), 1);

  resolveWinners(room);
  assert.equal(room.winnerId, 'p1', 'p1 wins with highest summit value (10 vs 5)');
});

test('equal turns guarantee: all players must complete same number of turns', () => {
  const room = makeStartedRoom({ playerCount: 3 });

  room.players[0].turns = 3;
  room.players[1].turns = 2;
  room.players[2].turns = 2;
  room.lastRound = true;
  room.currentIndex = 1;

  assert.equal(isLastRoundComplete(room), false, 'turns not equalized yet');

  // Advance p1 (index 1): turns becomes 3, currentIndex becomes 2
  advanceTurnState(room);
  assert.equal(room.players[1].turns, 3);
  assert.equal(isLastRoundComplete(room), false, 'p2 still behind');

  // Advance p2 (index 2): turns becomes 3, currentIndex becomes 0
  advanceTurnState(room);
  assert.equal(room.players[2].turns, 3);
  assert.equal(isLastRoundComplete(room), true, 'all players at 3 turns');
});

test('bump chain: player A bumps B, later B bumps A', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];
  const p1 = room.players[1];

  // p1 at summit on mountain 0 (height 4)
  p1.pos[0] = room.mountains[0].height;

  // p0 one step below summit
  p0.pos[0] = room.mountains[0].height - 1;

  // p0 climbs to summit, bumps p1
  applyClimb(room, p0, 0, noopLog());
  assert.equal(p0.pos[0], room.mountains[0].height, 'p0 at summit');
  assert.equal(p1.pos[0], 0, 'p1 bumped to base');

  // p1 climbs back to one step below summit
  p1.pos[0] = room.mountains[0].height - 1;

  // p1 climbs to summit, bumps p0
  applyClimb(room, p1, 0, noopLog());
  assert.equal(p1.pos[0], room.mountains[0].height, 'p1 at summit');
  assert.equal(p0.pos[0], 0, 'p0 bumped to base');
});

test('harvest on summit when already at top collects token without moving', () => {
  const room = makeStartedRoom({ playerCount: 2 });
  const p0 = room.players[0];

  // p0 already at summit on mountain 0
  p0.pos[0] = room.mountains[0].height;
  const posBefore = p0.pos[0];

  applyClimb(room, p0, 0, noopLog());

  assert.equal(p0.pos[0], posBefore, 'position unchanged');
  assert.equal(p0.collected[0], 1, 'collected 1 token');
});

test('match stat updates for unauthenticated players', () => {
  const room = makeStartedRoom({ playerCount: 2 });

  // Neither player has authUserId (default is null)
  room.players[0].collected = [1, 0, 0, 0, 0, 0];
  resolveWinners(room);

  const updates = buildMatchStatUpdates(room);
  assert.equal(updates.length, 0, 'no updates for unauthenticated players');
});

test('match stat updates include correct won flag for standard mode', () => {
  const room = makeStartedRoom({ playerCount: 3 });

  room.players[0].authUserId = 'user-a';
  room.players[1].authUserId = 'user-b';
  // p2 has no authUserId

  // p0 has highest score
  room.players[0].collected = [3, 0, 0, 0, 0, 0]; // 15 points
  room.players[1].collected = [1, 0, 0, 0, 0, 0]; // 5 points
  room.players[2].collected = [0, 1, 0, 0, 0, 0]; // 6 points

  resolveWinners(room);

  const updates = buildMatchStatUpdates(room);
  assert.equal(updates.length, 2, 'only 2 authenticated players');

  const userA = updates.find((u) => u.userId === 'user-a');
  const userB = updates.find((u) => u.userId === 'user-b');
  assert.equal(userA.won, true, 'p0 (user-a) won');
  assert.equal(userB.won, false, 'p1 (user-b) lost');
});
