const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getMode,
  getModeForRoom,
  listModes,
  setRoomMode,
  syncModeFields,
  normalizeModeId,
  DEFAULT_MODE_ID,
} = require('../../game/modes');
const { makeRoom } = require('../helpers/fixtures');

test('getMode returns standard and standardTeam by id', () => {
  assert.equal(getMode('standard').id, 'standard');
  assert.equal(getMode('standardTeam').id, 'standardTeam');
  assert.equal(getMode('standard').statKey, 'standard');
  assert.equal(getMode('standardTeam').statKey, 'team');
  assert.equal(getMode('standardTeam').usesTeams, true);
});

test('getMode maps legacy team id to standardTeam', () => {
  assert.equal(normalizeModeId('team'), 'standardTeam');
  assert.equal(getMode('team').id, 'standardTeam');
  assert.equal(getMode('unknown').id, DEFAULT_MODE_ID);
});

test('listModes includes standard and standardTeam', () => {
  const ids = listModes().map((m) => m.id).sort();
  assert.equal(ids.length, 2);
  assert.ok(ids.includes('standard'));
  assert.ok(ids.includes('standardTeam'));
});

test('getModeForRoom uses modeId when present', () => {
  const room = makeRoom({ playerCount: 2, modeId: 'standardTeam' });
  assert.equal(getModeForRoom(room).id, 'standardTeam');
  assert.equal(room.teamMode, true);
});

test('getModeForRoom falls back to legacy teamMode', () => {
  const room = { teamMode: true };
  assert.equal(getModeForRoom(room).id, 'standardTeam');
});

test('setRoomMode syncs modeId and teamMode', () => {
  const room = makeRoom({ playerCount: 4 });
  const logs = [];
  setRoomMode(room, 'standardTeam', (msg) => logs.push(msg));
  assert.equal(room.modeId, 'standardTeam');
  assert.equal(room.teamMode, true);
  assert.ok(room.teams);
  assert.ok(logs.some((m) => m.includes('Team mode enabled')));

  setRoomMode(room, 'standard', (msg) => logs.push(msg));
  assert.equal(room.modeId, 'standard');
  assert.equal(room.teamMode, false);
  assert.equal(room.teams, null);
  assert.ok(logs.some((m) => m.includes('Team mode disabled')));
});

test('syncModeFields keeps modeId and teamMode consistent', () => {
  const room = {};
  syncModeFields(room, null, true);
  assert.equal(room.modeId, 'standardTeam');
  assert.equal(room.teamMode, true);
  syncModeFields(room, 'standard');
  assert.equal(room.modeId, 'standard');
  assert.equal(room.teamMode, false);
});

test('legacy setRoomMode team alias enables standardTeam', () => {
  const room = makeRoom({ playerCount: 4 });
  setRoomMode(room, 'team', () => {});
  assert.equal(room.modeId, 'standardTeam');
  assert.equal(room.teamMode, true);
});
