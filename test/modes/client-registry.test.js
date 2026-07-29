const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Load client mode scripts into an isolated sandbox.
 *
 * @returns {object} Sandbox with GameModes.
 */
function loadClientModes() {
  const sandbox = { console, window: {} };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  const root = path.join(__dirname, '../../public/js/modes');
  for (const file of ['index.js', 'standard.js', 'standardTeam.js']) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    vm.runInNewContext(code, sandbox, { filename: file });
  }
  return sandbox.GameModes;
}

test('client GameModes registers standard and standardTeam', () => {
  const GameModes = loadClientModes();
  assert.equal(GameModes.getMode('standard').id, 'standard');
  assert.equal(GameModes.getMode('standardTeam').id, 'standardTeam');
  assert.equal(GameModes.getMode('team').id, 'standardTeam');
  assert.equal(GameModes.getMode('unknown').id, 'standard');
  const ids = GameModes.listModes().map((m) => m.id);
  assert.equal(ids.length, 2);
  assert.ok(ids.includes('standard'));
  assert.ok(ids.includes('standardTeam'));
});

test('client resolveModeId prefers modeId over teamMode', () => {
  const GameModes = loadClientModes();
  assert.equal(GameModes.resolveModeId({ modeId: 'team' }), 'standardTeam');
  assert.equal(GameModes.resolveModeId({ modeId: 'standardTeam' }), 'standardTeam');
  assert.equal(GameModes.resolveModeId({ teamMode: true }), 'standardTeam');
  assert.equal(GameModes.resolveModeId({ modeId: 'standard', teamMode: true }), 'standard');
  assert.equal(GameModes.resolveModeId(null), 'standard');
});

test('client didPlayerWin for standard and standardTeam', () => {
  const GameModes = loadClientModes();
  const standardState = {
    finished: true,
    modeId: 'standard',
    winnerPlayerIds: ['p0'],
    winnerId: 'p0',
  };
  assert.equal(GameModes.getMode('standard').didPlayerWin(standardState, 'p0'), true);
  assert.equal(GameModes.getMode('standard').didPlayerWin(standardState, 'p1'), false);

  const teamState = {
    finished: true,
    modeId: 'standardTeam',
    winnerTeamId: 0,
    teams: [
      { id: 0, members: ['p0', 'p2'] },
      { id: 1, members: ['p1', 'p3'] },
    ],
  };
  assert.equal(GameModes.getMode('standardTeam').didPlayerWin(teamState, 'p0'), true);
  assert.equal(GameModes.getMode('standardTeam').didPlayerWin(teamState, 'p1'), false);
});

test('client roomsListLabel and shareLines', () => {
  const GameModes = loadClientModes();
  assert.equal(GameModes.getMode('standard').roomsListLabel({}), '🎯 Solo');
  assert.equal(GameModes.getMode('standardTeam').roomsListLabel({}), '👥 Team');

  const stdShare = GameModes.getMode('standard').shareLines({
    players: [
      { id: 'p0', name: 'A', score: 10, tops: 1 },
      { id: 'p1', name: 'B', score: 5, tops: 0 },
    ],
    winnerPlayerIds: ['p0'],
    winnerId: 'p0',
  });
  assert.ok(stdShare.winnerLine.includes('A'));
  assert.ok(stdShare.standings.includes('A'));

  const teamShare = GameModes.getMode('standardTeam').shareLines({
    teams: [
      { id: 0, name: 'Red', score: 20, tops: 2, members: ['p0'] },
      { id: 1, name: 'Blue', score: 10, tops: 1, members: ['p1'] },
    ],
    winnerTeamId: 0,
    players: [],
  });
  assert.ok(teamShare.winnerLine.includes('Red'));
});
