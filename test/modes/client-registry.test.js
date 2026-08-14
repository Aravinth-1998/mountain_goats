const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Load the English i18n catalog and build a minimal t() translator
 * so mode scripts produce real translated strings instead of raw keys.
 */
function buildTranslator() {
  const catalog = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../public/i18n/en.json'), 'utf8')
  );
  function lookup(obj, key) {
    if (!obj || !key) return undefined;
    const parts = key.split('.');
    let cur = obj;
    for (const p of parts) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return typeof cur === 'string' ? cur : undefined;
  }
  return function t(key, vars) {
    let raw = lookup(catalog, key);
    if (raw == null) return key;
    if (!vars) return raw;
    return raw.replace(/\{(\w+)\}/g, (_, name) => (
      vars[name] != null ? String(vars[name]) : `{${name}}`
    ));
  };
}

/**
 * Load client mode scripts into an isolated sandbox.
 *
 * @returns {object} Sandbox with GameModes.
 */
function loadClientModes() {
  const sandbox = { console, window: {} };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.t = buildTranslator();
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
  assert.equal(GameModes.getMode('standard').roomsListLabel({}), 'Solo');
  assert.equal(GameModes.getMode('standardTeam').roomsListLabel({}), 'Team');

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
  assert.ok(stdShare.standings.includes(' ⭐'));

  const teamShare = GameModes.getMode('standardTeam').shareLines({
    teams: [
      { id: 0, name: 'Red', score: 20, tops: 2, members: ['p0'] },
      { id: 1, name: 'Blue', score: 10, tops: 1, members: ['p1'] },
    ],
    winnerTeamId: 0,
    players: [],
  });
  assert.ok(teamShare.winnerLine.includes('Red'));
  assert.ok(teamShare.standings.includes(' ⭐'));
});
