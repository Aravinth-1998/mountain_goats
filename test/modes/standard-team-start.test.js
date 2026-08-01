const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canStart, syncLobbyForStart } = require('../../game/modes/standardTeam/lobby');
const { makeRoom } = require('../helpers/fixtures');

test('canStart accepts a 3v3 team lobby (6 players in 2 teams)', () => {
  // The reported bug: a 3v3 lobby was told teams were unequal. When
  // room.teams is clean, this must return ok.
  const room = makeRoom({ playerCount: 6, teamMode: true });
  assert.deepEqual(room.teams.map((t) => t.members.length), [3, 3]);
  const result = canStart(room);
  assert.deepEqual(result, { ok: true });
});

test('canStart rejects genuinely unequal teams', () => {
  const room = makeRoom({ playerCount: 6, teamMode: true });
  // Move a player from team 1 to team 0 without cleaning up — simulates a bug.
  const moved = room.teams[1].members.pop();
  room.teams[0].members.push(moved);
  assert.deepEqual(room.teams.map((t) => t.members.length), [4, 2]);
  const result = canStart(room);
  assert.equal(result.ok, false);
  assert.match(result.reason, /equal number of players/);
});

test('canStart falls back to ok when teams have not been built yet', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.teams = null;
  assert.deepEqual(canStart(room), { ok: true });
});

test('canStart requires at least 2 players', () => {
  const room = makeRoom({ playerCount: 1, teamMode: true });
  const result = canStart(room);
  assert.equal(result.ok, false);
  assert.match(result.reason, /at least 2 players/);
});

test('syncLobbyForStart removes a duplicate within a single team', () => {
  // Regression: a stale duplicate id inside team 0 used to inflate its
  // members.length to 4, so canStart said [4,3] "unequal" for what looked
  // like a 3v3 lobby.
  const room = makeRoom({ playerCount: 6, teamMode: true });
  room.teams[0].members.push(room.teams[0].members[0]); // duplicate p0 in team 0
  syncLobbyForStart(room);
  assert.deepEqual(room.teams.map((t) => t.members.length), [3, 3]);
  assert.deepEqual(canStart(room), { ok: true });
});

test('syncLobbyForStart removes a cross-team duplicate, keeping the first team\'s claim', () => {
  const room = makeRoom({ playerCount: 6, teamMode: true });
  // p0 is in team 0 by round-robin; also plant them in team 1 as a stale entry.
  room.teams[1].members.unshift('p0');
  syncLobbyForStart(room);
  // p0 stays in team 0 (first team to claim wins), team 1 loses the duplicate.
  assert.ok(room.teams[0].members.includes('p0'));
  assert.equal(room.teams[1].members.filter((id) => id === 'p0').length, 0);
  assert.deepEqual(room.teams.map((t) => t.members.length), [3, 3]);
});

test('syncLobbyForStart drops ids for players no longer in the room', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.teams[0].members.push('ghost'); // player left, id lingered
  syncLobbyForStart(room);
  assert.equal(room.teams.flatMap((t) => t.members).includes('ghost'), false);
});

test('syncLobbyForStart auto-assigns an unassigned player to the smallest team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // Remove p3 from any team so they're unassigned.
  room.teams.forEach((t) => (t.members = t.members.filter((id) => id !== 'p3')));
  assert.deepEqual(room.teams.map((t) => t.members.length), [2, 1]);
  syncLobbyForStart(room);
  assert.deepEqual(room.teams.map((t) => t.members.length), [2, 2]);
  assert.ok(room.teams[1].members.includes('p3'), 'unassigned player joins the smallest team');
});
