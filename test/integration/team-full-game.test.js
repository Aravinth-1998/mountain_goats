const { test } = require('node:test');
const assert = require('node:assert/strict');
const { applyClimb, checkEndgameTrigger } = require('../../game/actions/climb');
const { advanceTurnState, isLastRoundComplete } = require('../../game/actions/turn');
const { scoreOf } = require('../../game/scoring/scoring');
const { teamScoreOf, teamTopsOf, areTeammates } = require('../../game/teams/scoring');
const { rankedTeams } = require('../../game/scoring/ranking');
const { resolveWinners, announceWinners, buildMatchStatUpdates } = require('../../game/match/winners');
const { makeStartedRoom, collectLog, noopLog } = require('../helpers/game-flow');

test('team mode: teammates co-occupy summit', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  const p0 = room.players[0]; // Red team
  const p2 = room.players[2]; // Red team (teammate)

  // p0 already at summit on mountain 0 (height 4)
  p0.pos[0] = room.mountains[0].height;

  // p2 one step below summit
  p2.pos[0] = room.mountains[0].height - 1;

  // p2 climbs to summit — should co-occupy, not bump p0
  applyClimb(room, p2, 0, noopLog());

  assert.ok(p0.pos[0] >= room.mountains[0].height, 'p0 still at summit');
  assert.ok(p2.pos[0] >= room.mountains[0].height, 'p2 also at summit');
});

test('team mode: opponent team wipeout', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  const p0 = room.players[0]; // Red team
  const p1 = room.players[1]; // Blue team

  // p1 (Blue) at summit on mountain 0
  p1.pos[0] = room.mountains[0].height;

  // p0 (Red) one step below
  p0.pos[0] = room.mountains[0].height - 1;

  const { log, messages } = collectLog();

  // p0 climbs to summit — bumps p1 (opponent)
  applyClimb(room, p0, 0, log);

  assert.equal(p0.pos[0], room.mountains[0].height, 'p0 at summit');
  assert.equal(p1.pos[0], 0, 'p1 bumped to base');
  assert.ok(messages.some((m) => m.includes('wiped off')), 'wipeout logged');
});

test('team mode: multi-opponent wipeout', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  const p0 = room.players[0]; // Red team
  const p1 = room.players[1]; // Blue team
  const p3 = room.players[3]; // Blue team

  // Both Blue players at summit on mountain 0
  p1.pos[0] = room.mountains[0].height;
  p3.pos[0] = room.mountains[0].height;

  // p0 one step below
  p0.pos[0] = room.mountains[0].height - 1;

  applyClimb(room, p0, 0, noopLog());

  assert.equal(p0.pos[0], room.mountains[0].height, 'p0 at summit');
  assert.equal(p1.pos[0], 0, 'p1 bumped to base');
  assert.equal(p3.pos[0], 0, 'p3 bumped to base');
});

test('team mode: winner is determined by team aggregate score', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  // Red team: p0, p2 — Blue team: p1, p3

  // Red team total: 5+7 = 12
  room.players[0].collected = [1, 0, 0, 0, 0, 0]; // 5 points
  room.players[2].collected = [0, 0, 1, 0, 0, 0]; // 7 points

  // Blue team total: 6+0 = 6
  room.players[1].collected = [0, 1, 0, 0, 0, 0]; // 6 points
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // 0 points

  resolveWinners(room);

  assert.equal(room.winnerTeamId, 0, 'Red team wins');
  assert.equal(room.winnerId, 'p2', 'highest scorer within Red is p2 (7 > 5)');
  assert.equal(room.finished, true);
});

test('team mode: team tiebreak by teamTopsOf', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });

  // Both teams have same total score: 11 each
  // Red: p0 (5+6=11), p2 (0)
  room.players[0].collected = [1, 1, 0, 0, 0, 0]; // 11 points
  room.players[2].collected = [0, 0, 0, 0, 0, 0]; // 0 points

  // Blue: p1 (5+6=11), p3 (0)
  room.players[1].collected = [1, 1, 0, 0, 0, 0]; // 11 points
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // 0 points

  // Red has 2 summits, Blue has 1
  room.players[0].pos[0] = room.mountains[0].height; // Red summit on mountain 0
  room.players[2].pos[1] = room.mountains[1].height; // Red summit on mountain 1
  room.players[1].pos[2] = room.mountains[2].height; // Blue summit on mountain 2

  const redTeam = room.teams[0];
  const blueTeam = room.teams[1];
  assert.equal(teamScoreOf(room, redTeam), 11);
  assert.equal(teamScoreOf(room, blueTeam), 11);
  assert.equal(teamTopsOf(room, redTeam), 2);
  assert.equal(teamTopsOf(room, blueTeam), 1);

  resolveWinners(room);
  assert.equal(room.winnerTeamId, 0, 'Red wins with more summits');
});

test('team mode: team tiebreak by highest top value', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });

  // Both teams same score: 10 each
  room.players[0].collected = [2, 0, 0, 0, 0, 0]; // Red p0: 10 points
  room.players[2].collected = [0, 0, 0, 0, 0, 0]; // Red p2: 0 points
  room.players[1].collected = [0, 0, 0, 0, 0, 1]; // Blue p1: 10 points
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // Blue p3: 0 points

  // Both teams have 1 summit each
  // Red holds mountain 0 summit (value 5)
  room.players[0].pos[0] = room.mountains[0].height;
  // Blue holds mountain 5 summit (value 10)
  room.players[1].pos[5] = room.mountains[5].height;

  const redTeam = room.teams[0];
  const blueTeam = room.teams[1];
  assert.equal(teamTopsOf(room, redTeam), 1);
  assert.equal(teamTopsOf(room, blueTeam), 1);

  resolveWinners(room);
  assert.equal(room.winnerTeamId, 1, 'Blue wins with highest summit value (10 vs 5)');
});

test('team mode: full game to completion', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  const p0 = room.players[0]; // Red
  const p1 = room.players[1]; // Blue

  // Set 3 mountains to 1 chip each
  room.mountains[0].chips = 1;
  room.mountains[1].chips = 1;
  room.mountains[2].chips = 1;

  // p0 at summit on mountains 0, 1, 2
  p0.pos[0] = room.mountains[0].height;
  p0.pos[1] = room.mountains[1].height;
  p0.pos[2] = room.mountains[2].height;

  // Harvest all 3 to empty them
  applyClimb(room, p0, 0, noopLog());
  applyClimb(room, p0, 1, noopLog());
  applyClimb(room, p0, 2, noopLog());

  assert.equal(room.lastRound, true, 'lastRound triggered');
  assert.equal(room.endReason, 'empty');

  // Equalize turns — 4 players each get 1 turn
  room.currentIndex = 0;
  advanceTurnState(room); // p0 turns=1
  advanceTurnState(room); // p1 turns=1
  advanceTurnState(room); // p2 turns=1
  advanceTurnState(room); // p3 turns=1

  assert.equal(isLastRoundComplete(room), true, 'all players have equal turns');

  resolveWinners(room);
  assert.equal(room.finished, true);
  assert.ok(room.winnerTeamId != null, 'winnerTeamId is set');
});

test('team mode: match stat updates assign win to entire winning team', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });

  // All 4 players authenticated
  room.players[0].authUserId = 'user-a'; // Red
  room.players[1].authUserId = 'user-b'; // Blue
  room.players[2].authUserId = 'user-c'; // Red
  room.players[3].authUserId = 'user-d'; // Blue

  // Red team wins with higher score
  room.players[0].collected = [2, 0, 0, 0, 0, 0]; // 10 points
  room.players[2].collected = [1, 0, 0, 0, 0, 0]; // 5 points
  room.players[1].collected = [0, 1, 0, 0, 0, 0]; // 6 points
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // 0 points

  resolveWinners(room);

  const updates = buildMatchStatUpdates(room);
  assert.equal(updates.length, 4, 'all 4 authenticated players');

  const userA = updates.find((u) => u.userId === 'user-a');
  const userB = updates.find((u) => u.userId === 'user-b');
  const userC = updates.find((u) => u.userId === 'user-c');
  const userD = updates.find((u) => u.userId === 'user-d');

  assert.equal(userA.won, true, 'Red p0 won');
  assert.equal(userC.won, true, 'Red p2 won');
  assert.equal(userB.won, false, 'Blue p1 lost');
  assert.equal(userD.won, false, 'Blue p3 lost');
  assert.equal(userA.teamMode, true, 'teamMode flag set');
});

test('team mode: harvest does not bump teammate already on summit', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });
  const p0 = room.players[0]; // Red
  const p2 = room.players[2]; // Red (teammate)

  // Both Red teammates at summit on mountain 0
  p0.pos[0] = room.mountains[0].height;
  p2.pos[0] = room.mountains[0].height;

  // p0 harvests (already at summit)
  applyClimb(room, p0, 0, noopLog());

  assert.equal(p0.pos[0], room.mountains[0].height, 'p0 still at summit');
  assert.equal(p2.pos[0], room.mountains[0].height, 'p2 still at summit');
  assert.equal(p0.collected[0], 1, 'p0 collected token');
});

test('team mode: announceWinners logs team name', () => {
  const room = makeStartedRoom({ playerCount: 4, teamMode: true });

  // Red team wins
  room.players[0].collected = [3, 0, 0, 0, 0, 0]; // 15 points
  room.players[2].collected = [1, 0, 0, 0, 0, 0]; // 5 points
  room.players[1].collected = [0, 1, 0, 0, 0, 0]; // 6 points
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // 0 points

  resolveWinners(room);

  const { log, messages } = collectLog();
  announceWinners(room, log);

  assert.ok(messages.length > 0, 'at least one log message');
  assert.ok(messages.some((m) => m.includes('Team Red')), 'log mentions Team Red');
});
