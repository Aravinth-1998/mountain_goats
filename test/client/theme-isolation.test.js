const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '../..');

/**
 * Read a UTF-8 file relative to the project root.
 *
 * @param {string} relativePath Path under the repo root.
 * @returns {string}
 */
function readRoot(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

/**
 * Strip CSS block comments before scanning selectors.
 *
 * @param {string} css Stylesheet source.
 * @returns {string}
 */
function stripCssComments(css) {
  return String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Extract top-level selector lists from a CSS string.
 *
 * @param {string} css Stylesheet source.
 * @returns {string[]}
 */
function extractSelectors(css) {
  const cleaned = stripCssComments(css);
  const selectors = [];
  let depth = 0;
  let chunk = '';
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') {
      if (depth === 0) {
        const selector = chunk.trim();
        if (selector) selectors.push(selector);
        chunk = '';
      }
      depth += 1;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      chunk = '';
      continue;
    }
    if (depth === 0) chunk += ch;
  }
  return selectors;
}

/**
 * Whether every selector branch is scoped to a theme root.
 *
 * @param {string} selectorList Comma-separated selector list.
 * @param {string} themeId Theme id, e.g. modern.
 * @returns {boolean}
 */
function isThemeScoped(selectorList, themeId) {
  const root = `html[data-ui="${themeId}"]`;
  return selectorList
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .every((part) => (
      part === root
      || part.startsWith(`${root} `)
      || part.startsWith(`${root}.`)
      || part.startsWith(`${root}:`)
      || part.startsWith(`${root}[`)
    ));
}

/**
 * Load ui.js into a sandbox with a minimal document/localStorage.
 *
 * @param {{ stored?: string|null, attr?: string|null }} [opts] Initial theme state.
 * @returns {{ sandbox: object, html: { getAttribute: Function, setAttribute: Function }, store: object }}
 */
function loadUiModule(opts = {}) {
  const store = {};
  if (Object.prototype.hasOwnProperty.call(opts, 'stored') && opts.stored != null) {
    store.mg_ui = String(opts.stored);
  }
  const attrs = {};
  if (Object.prototype.hasOwnProperty.call(opts, 'attr') && opts.attr != null) {
    attrs['data-ui'] = String(opts.attr);
  }
  const html = {
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
    setAttribute(name, value) {
      attrs[name] = String(value);
    },
  };
  const sandbox = {
    console,
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
      },
    },
    window: {},
    document: {
      documentElement: html,
      querySelectorAll() { return []; },
      addEventListener() {},
      dispatchEvent() { return true; },
      createElement() {
        return {
          className: '',
          setAttribute() {},
          appendChild() {},
          style: {},
        };
      },
    },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readRoot('public/js/ui.js'), sandbox, { filename: 'ui.js' });
  return { sandbox, html, store, attrs };
}

test('modern.css visual selectors are scoped to the modern theme root', () => {
  const css = readRoot('public/css/modern.css');
  const selectors = extractSelectors(css).filter((selector) => (
    !selector.startsWith('@')
    && !/^from\b|^to\b|^\d+%/.test(selector)
  ));
  assert.ok(selectors.length > 10, 'expected modern theme rules');
  for (const selector of selectors) {
    assert.ok(
      isThemeScoped(selector, 'modern'),
      `unscoped modern selector: ${selector}`
    );
  }
});

test('classic base stylesheet does not hard-code modern theme roots', () => {
  const css = readRoot('public/css/style.css');
  assert.equal(
    (css.match(/html\[data-ui=["']modern["']\]/g) || []).length,
    0,
    'style.css must not contain modern theme overrides'
  );
  assert.equal(
    (css.match(/\.role-tag\b/g) || []).length,
    0,
    'role-tag styles belong in modern.css only'
  );
});

test('index loads classic and modern stylesheets and bootstraps data-ui', () => {
  const html = readRoot('public/index.html');
  assert.match(html, /href="\/css\/style\.css/);
  assert.match(html, /href="\/css\/modern\.css/);
  assert.match(html, /data-ui/);
  assert.match(html, /settings-style-classic/);
  assert.match(html, /settings-style-modern/);
  assert.match(html, /\/js\/ui\.js/);
});

test('theme registry defaults to classic and rejects unknown themes', () => {
  const { sandbox, attrs, store } = loadUiModule({ stored: 'neon-future' });
  assert.ok(sandbox.MGUi, 'MGUi should be exported');
  assert.equal(sandbox.MGUi.getTheme(), 'classic');
  assert.equal(attrs['data-ui'], 'classic');
  assert.equal(sandbox.MGUi.setTheme('not-a-theme'), 'classic');
  assert.equal(store.mg_ui, 'classic');
  assert.equal(sandbox.MGUi.isModern(), false);
  assert.equal(sandbox.MGUi.hasFeature('goatArtwork'), false);
  assert.equal(sandbox.MGUi.hasFeature('heldWash'), false);
});

test('applied data-ui is authoritative over stale storage', () => {
  const { sandbox, attrs, store } = loadUiModule({ stored: 'modern' });
  assert.equal(sandbox.MGUi.getTheme(), 'modern');
  assert.equal(sandbox.MGUi.hasFeature('goatArtwork'), true);
  sandbox.MGUi.applyTheme('classic');
  assert.equal(attrs['data-ui'], 'classic');
  assert.equal(sandbox.MGUi.getTheme(), 'classic');
  assert.equal(store.mg_ui, 'modern');
  assert.equal(sandbox.MGUi.hasFeature('goatArtwork'), false);
});

test('future themes can register without changing classic defaults', () => {
  const { sandbox } = loadUiModule({});
  sandbox.MGUi.registerTheme({
    id: 'retro',
    features: { heldWash: true },
    icons: { trophy: '<svg id="t"></svg>' },
  });
  const themeIds = sandbox.MGUi.listThemes();
  assert.equal(themeIds.length, 3);
  assert.ok(themeIds.includes('classic'));
  assert.ok(themeIds.includes('modern'));
  assert.ok(themeIds.includes('retro'));
  assert.equal(sandbox.MGUi.setTheme('retro'), 'retro');
  assert.equal(sandbox.MGUi.hasFeature('heldWash'), true);
  assert.equal(sandbox.MGUi.hasFeature('goatArtwork'), false);
  assert.equal(sandbox.MGUi.icon('trophy'), '<svg id="t"></svg>');
  assert.equal(sandbox.MGUi.icon('host'), '&#128081;');
});

test('player-colors stay theme-neutral and balanced', () => {
  const { pickJoinColor, JOIN_COLOR_GROUPED_LIMIT } = require('../../game/core/player-colors');
  const { PLAYER_COLORS, PLAYER_COLOR_GROUPS } = require('../../game/core/constants');
  assert.equal(PLAYER_COLOR_GROUPS.length, 4);
  assert.ok(PLAYER_COLORS.length >= 10);
  assert.equal(JOIN_COLOR_GROUPED_LIMIT, 8);

  const room = { players: [] };
  for (let i = 0; i < 4; i++) {
    const color = pickJoinColor(room);
    assert.ok(PLAYER_COLORS.includes(color));
    room.players.push({ color });
  }
  const firstRoundGroups = new Set(room.players.map((player) => {
    return PLAYER_COLOR_GROUPS.findIndex((group) => group.includes(player.color));
  }));
  assert.equal(firstRoundGroups.size, 4);
});
