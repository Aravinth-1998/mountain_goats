const { test } = require('node:test');
const assert = require('node:assert/strict');
const { canStart, prepareStart, syncLobbyForStart, onSetMode, onClearMode, onPlayerJoined } = require('../../game/modes/standardTeam/lobby');
const { makeRoom, makePlayer } = require('../helpers/fixtures');
const { syncModeFields, setRoomMode } = require('../../game/modes');

test('canStart returns ok:true with equal teams', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  const result = canStart(room);
  assert.equal(result.ok, true);
});

test('canStart rejects unequal teams', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.teams[0].members = ['p0', 'p1', 'p2'];
  room.teams[1].members = ['p3'];
  const result = canStart(room);
  assert.equal(result.ok, false);
});

test('canStart allows start with no teams', () => {
  const room = makeRoom({ playerCount: 2, teamMode: true });
  room.teams = null;
  const result = canStart(room);
  assert.equal(result.ok, true);
});

test('canStart rejects if fewer than 2 players', () => {
  const room = makeRoom({ playerCount: 1, teamMode: true });
  const result = canStart(room);
  assert.equal(result.ok, false);
});

test('prepareStart interleaves players by team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // teams[0] has p0,p2 and teams[1] has p1,p3
  prepareStart(room);
  const orderIds = room.players.map(p => p.id);

  // Find which team each player belongs to
  const teamOf = {};
  for (const team of room.teams) {
    for (const mid of team.members) {
      teamOf[mid] = team.id;
    }
  }

  // Verify no two consecutive players share the same team
  for (let i = 0; i < orderIds.length - 1; i++) {
    assert.notEqual(
      teamOf[orderIds[i]],
      teamOf[orderIds[i + 1]],
      `Players at index ${i} and ${i + 1} should be from different teams`
    );
  }
});

test('prepareStart with fewer than 2 teams falls back to shuffle', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.teams = null;
  const idsBefore = room.players.map(p => p.id).sort();
  prepareStart(room);
  const idsAfter = room.players.map(p => p.id).sort();
  assert.deepEqual(idsAfter, idsBefore);
});

test('syncLobbyForStart removes stale player IDs from teams', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  room.teams[0].members.push('ghost');
  const calls = [];
  const mockSetRoomMode = (...args) => calls.push(args);
  syncLobbyForStart(room, () => {}, mockSetRoomMode);
  const allMembers = room.teams.flatMap(t => t.members);
  assert.ok(!allMembers.includes('ghost'), 'Ghost ID should be removed');
});

test('syncLobbyForStart deduplicates player across teams', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // p0 is already in teams[0]; add to teams[1] too
  room.teams[1].members.push('p0');
  const calls = [];
  const mockSetRoomMode = (...args) => calls.push(args);
  syncLobbyForStart(room, () => {}, mockSetRoomMode);
  const allMembers = room.teams.flatMap(t => t.members);
  const p0Count = allMembers.filter(id => id === 'p0').length;
  assert.equal(p0Count, 1, 'p0 should appear in exactly one team');
});

test('syncLobbyForStart assigns unassigned players to smallest team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // Remove p2 from its team
  for (const team of room.teams) {
    team.members = team.members.filter(id => id !== 'p2');
  }
  const calls = [];
  const mockSetRoomMode = (...args) => calls.push(args);
  syncLobbyForStart(room, () => {}, mockSetRoomMode);
  const allMembers = room.teams.flatMap(t => t.members);
  assert.ok(allMembers.includes('p2'), 'p2 should be assigned to a team');
});

test('syncLobbyForStart downgrades to standard when fewer than 2 teams', () => {
  const room = makeRoom({ playerCount: 2, teamMode: true });
  // Put all players in team 0, empty team 1 so it gets filtered out
  room.teams[0].members = ['p0', 'p1'];
  room.teams[1].members = [];
  const calls = [];
  const mockSetRoomMode = (...args) => calls.push(args);
  syncLobbyForStart(room, () => {}, mockSetRoomMode);
  assert.ok(calls.length > 0, 'setRoomMode should have been called');
  assert.equal(calls[0][1], 'standard');
});

test('onSetMode builds teams via round-robin', () => {
  const room = makeRoom({ playerCount: 4 });
  assert.equal(room.teams, null);
  onSetMode(room);
  assert.ok(Array.isArray(room.teams), 'teams should be created');
  assert.ok(room.teams.length >= 2, 'should have at least 2 teams');
  const allMembers = room.teams.flatMap(t => t.members).sort();
  const playerIds = room.players.map(p => p.id).sort();
  assert.deepEqual(allMembers, playerIds, 'all players should be assigned to teams');
});

test('onClearMode clears teams', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  assert.ok(room.teams !== null);
  onClearMode(room);
  assert.equal(room.teams, null);
  assert.equal(room.winnerTeamId, null);
});

test('onPlayerJoined assigns new player to smallest team', () => {
  const room = makeRoom({ playerCount: 4, teamMode: true });
  // teams[0] has p0,p2 (size 2) and teams[1] has p1,p3 (size 2)
  // Remove one member from teams[1] to make it smaller
  room.teams[1].members = ['p1'];
  const newPlayer = makePlayer({ id: 'p4', name: 'Player 4' });
  room.players.push(newPlayer);
  onPlayerJoined(room, newPlayer);
  assert.ok(
    room.teams[1].members.includes('p4'),
    'New player should be added to the smaller team'
  );
});
