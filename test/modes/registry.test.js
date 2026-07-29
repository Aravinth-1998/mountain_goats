const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  getMode,
  getModeForRoom,
  listModes,
  setRoomMode,
  syncModeFields,
  DEFAULT_MODE_ID,
} = require('../../game/modes');
const { makeRoom } = require('../helpers/fixtures');

test('getMode returns standard and team by id', () => {
  assert.equal(getMode('standard').id, 'standard');
  assert.equal(getMode('team').id, 'team');
  assert.equal(getMode('standard').statKey, 'standard');
  assert.equal(getMode('team').statKey, 'team');
});

test('getMode falls back to standard for unknown ids', () => {
  assert.equal(getMode('unknown').id, DEFAULT_MODE_ID);
  assert.equal(getMode(undefined).id, DEFAULT_MODE_ID);
});

test('listModes includes standard and team', () => {
  const ids = listModes().map((m) => m.id).sort();
  assert.deepEqual(ids, ['standard', 'team']);
});

test('getModeForRoom uses modeId when present', () => {
  const room = makeRoom({ playerCount: 2, modeId: 'team' });
  assert.equal(getModeForRoom(room).id, 'team');
  assert.equal(room.teamMode, true);
});

test('getModeForRoom falls back to legacy teamMode', () => {
  const room = { teamMode: true };
  assert.equal(getModeForRoom(room).id, 'team');
});

test('setRoomMode syncs modeId and teamMode', () => {
  const room = makeRoom({ playerCount: 4 });
  const logs = [];
  setRoomMode(room, 'team', (msg) => logs.push(msg));
  assert.equal(room.modeId, 'team');
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
  assert.equal(room.modeId, 'team');
  assert.equal(room.teamMode, true);
  syncModeFields(room, 'standard');
  assert.equal(room.modeId, 'standard');
  assert.equal(room.teamMode, false);
});
