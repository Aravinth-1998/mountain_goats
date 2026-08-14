const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankedPlayers, rankedTeams, winnerSlotCount } = require('../../game/scoring/ranking');
const { makeRoom, makePlayer, makeTeams } = require('../helpers/fixtures');

// rankedPlayers sorts by: score desc → tops desc → highestTopValue desc
// Mountains: 0=val5(h4), 1=val6(h4), 2=val7(h3), 3=val8(h3), 4=val9(h2), 5=val10(h2)

test('rankedPlayers with perfect tie on all criteria preserves input order', () => {
  const room = makeRoom({ playerCount: 2 });
  // Both players: same collected, pos, bonus → identical score, tops, highTop
  room.players[0].collected = [1, 0, 0, 0, 0, 0];
  room.players[1].collected = [1, 0, 0, 0, 0, 0];
  const ranked = rankedPlayers(room);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].p.id, 'p0');
  assert.equal(ranked[1].p.id, 'p1');
});

test('rankedPlayers ranks by score first', () => {
  const room = makeRoom({ playerCount: 2 });
  // p0: higher score (collected 2 of value-10), no tops
  room.players[0].collected = [0, 0, 0, 0, 0, 2]; // 20 points
  // p1: lower score but at summit of mountain 0
  room.players[1].collected = [1, 0, 0, 0, 0, 0]; // 5 points
  room.players[1].pos = [4, 0, 0, 0, 0, 0];       // 1 top
  const ranked = rankedPlayers(room);
  assert.equal(ranked[0].p.id, 'p0');
  assert.equal(ranked[1].p.id, 'p1');
});

test('rankedPlayers ranks 3+ players correctly', () => {
  const room = makeRoom({ playerCount: 4 });
  room.players[0].collected = [0, 0, 0, 0, 0, 1]; // 10
  room.players[1].collected = [0, 0, 0, 0, 0, 3]; // 30
  room.players[2].collected = [0, 0, 0, 0, 0, 2]; // 20
  room.players[3].collected = [1, 0, 0, 0, 0, 0]; // 5
  const ranked = rankedPlayers(room);
  assert.equal(ranked[0].p.id, 'p1'); // 30
  assert.equal(ranked[1].p.id, 'p2'); // 20
  assert.equal(ranked[2].p.id, 'p0'); // 10
  assert.equal(ranked[3].p.id, 'p3'); // 5
});

test('rankedTeams ranks teams by aggregate score', () => {
  // teams[0].members = ['p0', 'p2'], teams[1].members = ['p1', 'p3']
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // Team 0 (p0+p2): 10+10 = 20
  room.players[0].collected = [0, 0, 0, 0, 0, 1]; // 10
  room.players[2].collected = [0, 0, 0, 0, 0, 1]; // 10
  // Team 1 (p1+p3): 30+10 = 40
  room.players[1].collected = [0, 0, 0, 0, 0, 3]; // 30
  room.players[3].collected = [0, 0, 0, 0, 0, 1]; // 10
  const ranked = rankedTeams(room);
  assert.equal(ranked[0].team.id, 1); // team 1 wins with 40
  assert.equal(ranked[1].team.id, 0); // team 0 has 20
});

test('rankedTeams breaks ties by team tops', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // Same total score for both teams: 10 each
  room.players[0].collected = [0, 0, 0, 0, 0, 1]; // team 0, 10 pts
  room.players[2].collected = [0, 0, 0, 0, 0, 0]; // team 0, 0 pts
  room.players[1].collected = [0, 0, 0, 0, 0, 1]; // team 1, 10 pts
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // team 1, 0 pts
  // Team 0: p0 at top of mountain 5 → 1 top
  room.players[0].pos = [0, 0, 0, 0, 0, 2];
  // Team 1: p1 at top of mountain 4 AND p3 at top of mountain 5 → 2 tops
  room.players[1].pos = [0, 0, 0, 0, 2, 0];
  room.players[3].pos = [0, 0, 0, 0, 0, 2];
  const ranked = rankedTeams(room);
  assert.equal(ranked[0].team.id, 1); // team 1 wins on tops (2 vs 1)
});

test('rankedTeams breaks ties by highest top value', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // Same total score: 5 each
  room.players[0].collected = [1, 0, 0, 0, 0, 0]; // team 0, 5 pts
  room.players[2].collected = [0, 0, 0, 0, 0, 0]; // team 0
  room.players[1].collected = [1, 0, 0, 0, 0, 0]; // team 1, 5 pts
  room.players[3].collected = [0, 0, 0, 0, 0, 0]; // team 1
  // Same tops count (1 each), but different highest value
  // Team 0: top of mountain 0 (value 5)
  room.players[0].pos = [4, 0, 0, 0, 0, 0];
  // Team 1: top of mountain 5 (value 10)
  room.players[1].pos = [0, 0, 0, 0, 0, 2];
  const ranked = rankedTeams(room);
  assert.equal(ranked[0].team.id, 1); // team 1 wins on highTop (10 vs 5)
});

test('rankedTeams returns empty for non-team room', () => {
  const room = makeRoom({ playerCount: 2 });
  const ranked = rankedTeams(room);
  assert.deepEqual(ranked, []);
});

test('winnerSlotCount returns 1 for 2 players', () => {
  const room = makeRoom({ playerCount: 2 });
  assert.equal(winnerSlotCount(room), 1);
});

test('winnerSlotCount returns 1 for 3 players', () => {
  const room = makeRoom({ playerCount: 3 });
  assert.equal(winnerSlotCount(room), 1);
});

test('winnerSlotCount uses connected count when some disconnected', () => {
  const room = makeRoom({ playerCount: 8 });
  // Disconnect 4 players → 4 connected → returns 1 (not 3)
  room.players[4].connected = false;
  room.players[5].connected = false;
  room.players[6].connected = false;
  room.players[7].connected = false;
  assert.equal(winnerSlotCount(room), 1);
});
