/**
 * Mountain Goats - shared UI helpers.
 *
 * This file owns the visual theme registry. A theme is a named bundle of
 * feature flags plus an icon set; the rest of the client asks the registry
 * what a theme supports instead of testing for one specific theme name, so a
 * new theme can be added here without touching the render code.
 *
 * Theme resolution: the persisted selection (localStorage) seeds the applied
 * data-ui attribute at startup; from then on the applied data-ui attribute is
 * the single source of truth, because that is what the stylesheets react to.
 * Unknown or missing values fall back to Classic, which is the baseline look.
 */
(function (root) {
  const UI_STORAGE_KEY = 'mg_ui';
  const UI_CLASSIC = 'classic';
  const UI_MODERN = 'modern';
  const THEME_EVENT = 'mg:stylechange';
  const THEME_LOCKED_EVENT = 'mg:themelocked';

  /**
   * Whether the player may use themes that require an account. Null until auth
   * has answered, so a signed-in player reloading on a gated theme is not
   * bounced to Classic before the session is restored.
   *
   * @type {boolean|null}
   */
  let themeAccessGranted = null;

  /**
   * Every theme feature the client can ask about, with the Classic (baseline)
   * answer as the default. A theme only lists the flags it turns on.
   */
  const DEFAULT_FEATURES = {
    // Player pieces / swatches use goat artwork instead of letter coins.
    goatArtwork: false,
    // Brand and loading goats use the title artwork instead of the emoji.
    brandArtwork: false,
    // Lobby host / bot are word tags instead of emoji icons.
    roleTags: false,
    // Colour wash on a mountain column whose summit is held.
    heldWash: false,
    // Hop animation when the local player's goat changes cell.
    climbAnimation: false,
    // Stats panels carry the player colour (and a light-colour text hook).
    panelPlayerColor: false,
    // Colour picker is limited to the curated artwork palette.
    curatedColorPicker: false,
  };

  /** Icon markup used by Classic; kept as entities so the source stays ASCII. */
  const CLASSIC_ICONS = {
    host: '&#128081;',
    bot: '&#129302;',
    pencil: '&#9999;&#65039;',
    trophy: '&#127942;',
    copy: '&#128203;',
  };

  /** Inline SVG for the copy-icon on the lobby room pill. */
  const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
    + '</svg>';

  /** Inline SVG pencil for the "edit colour" swatch badge. */
  const PENCIL_ICON_SVG = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
    + '</svg>';

  /** Inline SVG trophy for the lobby wins badge. */
  const TROPHY_ICON_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M8 3h8v5a4 4 0 0 1-8 0Z"/>'
    + '<path d="M8 5H5a3 3 0 0 0 3 3"/>'
    + '<path d="M16 5h3a3 3 0 0 1-3 3"/>'
    + '<path d="M12 12v4"/>'
    + '<path d="M9 20h6"/>'
    + '<path d="M10 20a2 2 0 0 1 4 0"/>'
    + '</svg>';

  /**
   * 10 vibrant goat colours - one per distinct goat image, all valid
   * PLAYER_COLORS hexes. No two entries share the same goat artwork.
   */
  const GOAT_COLORS = [
    '#e63946', // red
    '#1d4ed8', // blue
    '#22c55e', // green
    '#e67e22', // orange
    '#a855f7', // purple
    '#ec4899', // pink
    '#06d6a0', // cyan
    '#92400e', // brown
    '#f8fafc', // white
    '#facc15', // yellow
  ];

  const GOAT_INK = '#0f1728';

  /** Dominant colour of each goat image (used for nearest-colour matching). */
  const GOAT_IMAGE_BY_COLOR = {
    '#e63946': 'red.png',
    '#1d4ed8': 'blue.png',
    '#22c55e': 'green.png',
    '#e67e22': 'orange.png',
    '#a855f7': 'purple.png',
    '#ec4899': 'pink.png',
    '#06d6a0': 'cyan.png',
    '#92400e': 'brown.png',
    '#f8fafc': 'white.png',
    '#facc15': 'yellow.png',
  };

  /** Team sub-folders under /img/goats/team-goats/, indexed by team id. */
  const TEAM_GOAT_FOLDERS = ['red', 'blue', 'green'];

  /**
   * Team-goat artwork per team palette shade, referenced by image filename:
   * each of the 5 shades of a team maps 1:1 onto that team's 5 goat images.
   */
  const TEAM_GOAT_IMAGE_BY_COLOR = {
    // red team (team id 0)
    '#9d0208': 'brown.png',
    '#c1121f': 'red.png',
    '#e63946': 'light-red.png',
    '#ff5c5c': 'orange.png',
    '#ff7a7a': 'pink.png',
    // blue team (team id 1)
    '#1e40af': 'darkblue.png',
    '#1d4ed8': 'blue.png',
    '#3b82f6': 'violet.png',
    '#4f7cff': 'light-blue.png',
    '#93c5fd': 'cyan.png',
    // green team (team id 2)
    '#15803d': 'dark-green.png',
    '#40916c': 'green.png',
    '#22c55e': 'light-green.png',
    '#06d6a0': 'neon-green.png',
    '#86efac': 'lime-green.png',
  };

  /** @type {Map<string, {id: string, features: object, icons: object, requiresAuth: boolean}>} */
  const themes = new Map();

  /**
   * Add (or replace) a theme in the registry.
   *
   * @param {{id: string, features?: object, icons?: object, requiresAuth?: boolean}} definition Theme definition.
   * @returns {object|null} The stored theme, or null when the definition is unusable.
   */
  function registerTheme(definition) {
    const id = definition && typeof definition.id === 'string'
      ? definition.id.toLowerCase()
      : '';
    if (!id) return null;
    const theme = {
      id,
      features: Object.assign({}, DEFAULT_FEATURES, definition.features || {}),
      icons: Object.assign({}, CLASSIC_ICONS, definition.icons || {}),
      requiresAuth: !!(definition && definition.requiresAuth),
    };
    themes.set(id, theme);
    // A theme registered after startup can still take over when nothing valid
    // has been applied to the document yet.
    if (!appliedThemeId()) syncTheme();
    return theme;
  }

  /**
   * Ids of all registered themes, in registration order.
   *
   * @returns {string[]}
   */
  function listThemes() {
    return Array.from(themes.keys());
  }

  /**
   * Whether an id belongs to a registered theme.
   *
   * @param {string} id Candidate theme id.
   * @returns {boolean}
   */
  function isKnownTheme(id) {
    return themes.has(String(id || '').toLowerCase());
  }

  /**
   * Normalise a candidate theme id to a registered one.
   *
   * @param {string} value Raw value from storage or the DOM.
   * @returns {string|null} Registered theme id, or null when unknown.
   */
  function normalizeThemeId(value) {
    const id = String(value || '').toLowerCase();
    return themes.has(id) ? id : null;
  }

  /**
   * Theme currently applied to the document (what the stylesheets follow).
   *
   * @returns {string|null} Registered theme id, or null when unset or unknown.
   */
  function appliedThemeId() {
    const el = root.document && root.document.documentElement;
    return el ? normalizeThemeId(el.getAttribute('data-ui')) : null;
  }

  /**
   * Theme persisted as the user's preference.
   *
   * @returns {string|null} Registered theme id, or null when unset or unknown.
   */
  function storedThemeId() {
    try {
      return normalizeThemeId(root.localStorage.getItem(UI_STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  /**
   * Active theme id: the applied theme wins, then the persisted preference,
   * then Classic.
   *
   * @returns {string}
   */
  function getTheme() {
    return appliedThemeId() || storedThemeId() || UI_CLASSIC;
  }

  /**
   * Full definition of a theme.
   *
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {{id: string, features: object, icons: object}}
   */
  function getThemeConfig(id) {
    return themes.get(normalizeThemeId(id) || getTheme()) || themes.get(UI_CLASSIC);
  }

  /**
   * Feature flags of a theme (a copy, safe to read freely).
   *
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {object}
   */
  function themeFeatures(id) {
    return Object.assign({}, getThemeConfig(id).features);
  }

  /**
   * Whether a theme enables a feature.
   *
   * @param {string} feature Feature name from DEFAULT_FEATURES.
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {boolean}
   */
  function hasFeature(feature, id) {
    return !!getThemeConfig(id).features[feature];
  }

  /**
   * Icon markup for the active theme, e.g. 'host', 'bot', 'pencil', 'trophy'.
   *
   * @param {string} name Icon name.
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {string} HTML string, or '' when the theme has no such icon.
   */
  function icon(name, id) {
    const icons = getThemeConfig(id).icons;
    return icons && icons[name] ? icons[name] : '';
  }

  /**
   * Bot marker markup for the active theme: a "BOT" pill tag when the theme
   * enables role tags (Modern), otherwise the classic robot emoji.
   *
   * @param {string} [label] Localized tag text (e.g. the lobby bot title).
   * @returns {string} HTML string (classic returns a bare emoji).
   */
  function botTagHtml(label) {
    if (!hasFeature('roleTags')) return '&#129302;';
    const text = String(label || 'BOT')
      .replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    return `<span class="role-tag bot-tag">${text}</span>`;
  }

  /**
   * Whether a theme is only offered to signed-in players.
   *
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {boolean}
   */
  function themeRequiresAuth(id) {
    return !!getThemeConfig(id).requiresAuth;
  }

  /**
   * Whether a theme is currently out of reach for this player. Unknown access
   * (auth still resolving) counts as unlocked so nothing flickers on load.
   *
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {boolean}
   */
  function isThemeLocked(id) {
    return themeRequiresAuth(id) && themeAccessGranted === false;
  }

  /**
   * Announce that a locked theme was requested so the app can explain why.
   *
   * @param {string} id Theme the player tried to pick.
   * @returns {void}
   */
  function emitThemeLocked(id) {
    if (!root.document || typeof root.CustomEvent !== 'function') return;
    root.document.dispatchEvent(new root.CustomEvent(THEME_LOCKED_EVENT, {
      detail: { theme: id, style: id },
    }));
  }

  /**
   * Record whether gated themes are available, and fall back to Classic when
   * the player is on one they may no longer use (e.g. after signing out).
   *
   * @param {boolean} granted True once the player is signed in.
   * @returns {string} Theme id in force afterwards.
   */
  function setThemeAccess(granted) {
    const next = !!granted;
    const changed = themeAccessGranted !== next;
    themeAccessGranted = next;
    if (isThemeLocked(getTheme())) {
      // Persist the downgrade so the pre-paint bootstrap in index.html cannot
      // flash a gated theme on the next load.
      setTheme(UI_CLASSIC);
      applyThemeDom();
      emitThemeChange(UI_CLASSIC);
      return UI_CLASSIC;
    }
    if (changed) emitThemeChange(getTheme());
    return getTheme();
  }

  /**
   * Apply a theme to the document without touching the persisted preference.
   *
   * @param {string} [id] Theme id (defaults to the active theme).
   * @returns {string} Theme id that was applied.
   */
  function applyTheme(id) {
    const next = normalizeThemeId(id) || getTheme();
    const el = root.document && root.document.documentElement;
    if (el) el.setAttribute('data-ui', next);
    return next;
  }

  /**
   * Make the document match the persisted preference (used at startup).
   *
   * @returns {string} Theme id that was applied.
   */
  function syncTheme() {
    const preferred = storedThemeId() || appliedThemeId() || UI_CLASSIC;
    return applyTheme(isThemeLocked(preferred) ? UI_CLASSIC : preferred);
  }

  /**
   * Persist a theme and apply it. Unknown ids fall back to Classic.
   *
   * @param {string} id Theme id.
   * @returns {string} Theme id that was applied.
   */
  function setTheme(id) {
    const next = normalizeThemeId(id) || UI_CLASSIC;
    try {
      root.localStorage.setItem(UI_STORAGE_KEY, next);
    } catch (e) { /* ignore */ }
    return applyTheme(next);
  }

  /**
   * Tell the rest of the client that the theme changed so it can re-render.
   *
   * @param {string} id Theme id now in force.
   * @returns {void}
   */
  function emitThemeChange(id) {
    if (!root.document || typeof root.CustomEvent !== 'function') return;
    root.document.dispatchEvent(new root.CustomEvent(THEME_EVENT, {
      detail: { style: id, theme: id },
    }));
  }

  /**
   * Switch theme: persist, apply, refresh theme-owned DOM and notify listeners.
   * Themes that need an account are refused while the player is signed out.
   *
   * @param {string} id Theme id.
   * @returns {string} Theme id that was applied.
   */
  function changeTheme(id) {
    const wanted = normalizeThemeId(id) || UI_CLASSIC;
    if (isThemeLocked(wanted)) {
      emitThemeLocked(wanted);
      return getTheme();
    }
    const next = setTheme(wanted);
    applyThemeDom();
    emitThemeChange(next);
    return next;
  }

  /**
   * Whether the Modern theme is active. Kept for older call sites; prefer
   * hasFeature() so new themes work without extra checks.
   *
   * @returns {boolean}
   */
  function isModern() {
    return getTheme() === UI_MODERN;
  }

  /**
   * Pick the goat image whose colour is closest to the given hex colour.
   *
   * @param {string} color Hex colour like '#e63946'.
   * @returns {string} Image filename in /img/goats/.
   */
  function nearestGoatImage(color) {
    const fallback = 'red.png';
    let hex = String(color || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return fallback;
    const cr = parseInt(hex.slice(1, 3), 16);
    const cg = parseInt(hex.slice(3, 5), 16);
    const cb = parseInt(hex.slice(5, 7), 16);
    let best = fallback;
    let bestDist = Infinity;
    Object.keys(GOAT_IMAGE_BY_COLOR).forEach((key) => {
      const r = parseInt(key.slice(1, 3), 16) - cr;
      const g = parseInt(key.slice(3, 5), 16) - cg;
      const b = parseInt(key.slice(5, 7), 16) - cb;
      const dist = r * r + g * g + b * b;
      if (dist < bestDist) {
        bestDist = dist;
        best = GOAT_IMAGE_BY_COLOR[key];
      }
    });
    return best;
  }

  /**
   * URL of the goat image for a colour.
   *
   * In team mode, pass the player's team id so the team-goat artwork is used.
   *
   * @param {string} color Hex colour.
   * @param {number} [teamId] Team id 0-2 (team-goat artwork).
   * @returns {string}
   */
  function goatImgUrl(color, teamId) {
    if (typeof teamId === 'number' && TEAM_GOAT_FOLDERS[teamId]) {
      const file = TEAM_GOAT_IMAGE_BY_COLOR[String(color || '').toLowerCase()];
      if (file) {
        return '/img/goats/team-goats/' + TEAM_GOAT_FOLDERS[teamId] + '/' + file;
      }
    }
    return '/img/goats/' + nearestGoatImage(color);
  }

  /**
   * <img> tag for a coloured goat.
   *
   * @param {string} color Hex colour.
   * @param {string} [alt] Alt text.
   * @param {number} [teamId] Team id 0-2 (team-goat artwork).
   * @returns {string}
   */
  function goatImgHtml(color, alt, teamId) {
    const safe = String(alt || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<img class="goat-img" src="' + goatImgUrl(color, teamId) + '" alt="' + safe + '" draggable="false">';
  }

  /**
   * Convert a #rrggbb hex colour to an rgba() string.
   *
   * @param {string} color Hex colour.
   * @param {number} [alpha] Alpha 0-1.
   * @returns {string}
   */
  function hexToRgba(color, alpha) {
    const hex = String(color || '#e63946');
    const a = typeof alpha === 'number' ? alpha : 1;
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return 'rgba(0,0,0,' + a + ')';
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  /**
   * Whether a hex colour is light enough to need dark text on top.
   *
   * @param {string} color Hex colour.
   * @returns {boolean}
   */
  function isLightColor(color) {
    const hex = String(color || '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return false;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.62;
  }

  /**
   * Inline SVG goat, tinted with a hex colour.
   *
   * @param {string} color Hex fill for the goat.
   * @returns {string}
   */
  function goatSvg(color) {
    const c = color || '#e63946';
    const ink = GOAT_INK;
    return '<svg viewBox="0 0 64 72" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">'
      + '<path d="M54 30 C 60 28 62 21 58 17" fill="none" stroke="' + c + '" stroke-width="4" stroke-linecap="round"/>'
      + '<rect x="40.5" y="43" width="7" height="20" rx="3.5" fill="' + c + '"/>'
      + '<rect x="49" y="43" width="7" height="20" rx="3.5" fill="' + c + '"/>'
      + '<rect x="40.5" y="57" width="7" height="6" rx="3" fill="' + ink + '"/>'
      + '<rect x="49" y="57" width="7" height="6" rx="3" fill="' + ink + '"/>'
      + '<ellipse cx="38" cy="37.5" rx="18" ry="11" fill="' + c + '"/>'
      + '<ellipse cx="38" cy="41.5" rx="11" ry="6" fill="rgba(255,255,255,0.25)"/>'
      + '<rect x="14" y="43" width="7" height="20" rx="3.5" fill="' + c + '"/>'
      + '<rect x="22.5" y="43" width="7" height="20" rx="3.5" fill="' + c + '"/>'
      + '<rect x="14" y="57" width="7" height="6" rx="3" fill="' + ink + '"/>'
      + '<rect x="22.5" y="57" width="7" height="6" rx="3" fill="' + ink + '"/>'
      + '<path d="M20 32 L24 18 L32 20 L31 34 Z" fill="' + c + '"/>'
      + '<ellipse cx="17" cy="19.5" rx="9.5" ry="8.5" fill="' + c + '"/>'
      + '<g transform="rotate(28 25.5 17)">'
      + '<ellipse cx="25.5" cy="17" rx="3.5" ry="5.5" fill="' + c + '"/>'
      + '<ellipse cx="25.5" cy="17" rx="1.6" ry="3" fill="rgba(255,255,255,0.3)"/>'
      + '</g>'
      + '<path d="M14 12 C 11 3 19 -1 26 2" stroke="' + ink + '" stroke-width="3.5" fill="none" stroke-linecap="round"/>'
      + '<path d="M20 11.5 C 21 3 28 0 32 4" stroke="' + ink + '" stroke-width="3" fill="none" stroke-linecap="round"/>'
      + '<path d="M12 26 L10 34 L16 28 Z" fill="' + ink + '"/>'
      + '<circle cx="13.5" cy="17.5" r="1.6" fill="' + ink + '"/>'
      + '<circle cx="9" cy="23" r="1.1" fill="rgba(0,0,0,0.4)"/>'
      + '</svg>';
  }

  /**
   * Player icon (swatch): goat artwork when the theme uses it, otherwise the
   * baseline letter coin.
   *
   * @param {string} color Player colour.
   * @param {string} name Player name (used for the letter coin).
   * @param {string} [sizeClass] Extra swatch size class ('sm', ...).
   * @param {boolean} [markMe] Add the "me" styling hook.
   * @param {number} [teamId] Team id 0-2 (team-goat artwork).
   * @returns {string}
   */
  function playerIconHtml(color, name, sizeClass, markMe, teamId) {
    const cls = 'swatch'
      + (sizeClass ? ' ' + sizeClass : '')
      + (markMe ? ' me' : '');
    if (hasFeature('goatArtwork')) {
      return '<span class="' + cls + ' goat-swatch">' + goatImgHtml(color, name, teamId) + '</span>';
    }
    return '<span class="' + cls + '" style="background:' + color + '">'
      + String((name || ' ').charAt(0)).toUpperCase()
      + '</span>';
  }

  /**
   * Swap the brand / loading goats for the title artwork when the theme asks
   * for it, and restore the original emoji otherwise.
   *
   * @returns {void}
   */
  function applyThemeDom() {
    if (!root.document || !root.document.querySelectorAll) return;
    const artwork = hasFeature('brandArtwork');
    root.document.querySelectorAll('.goat-emoji, .loading-goat').forEach((el) => {
      if (el.dataset.mgOriginal === undefined) {
        el.dataset.mgOriginal = el.innerHTML;
      }
      if (artwork) {
        if (el.dataset.mgGoatImg === undefined) {
          el.dataset.mgGoatImg = '1';
          el.innerHTML = '<img class="goat-title-img" src="/img/goat_title.png" alt="" draggable="false">';
        }
      } else if (el.dataset.mgGoatImg !== undefined) {
        delete el.dataset.mgGoatImg;
        el.innerHTML = el.dataset.mgOriginal;
      }
    });
  }

  /**
   * Colours to offer in the colour picker for an artwork theme.
   *
   * @param {string[]} available Palette the server allows for this player.
   * @param {boolean} [keepAll] Keep every available shade (team palettes).
   * @returns {string[]}
   */
  function pickerColors(available, keepAll) {
    const list = (available && available.length) ? available : GOAT_COLORS;
    if (keepAll) return list.slice(0, 10);
    const curated = list.filter((c) => GOAT_COLORS.indexOf(c) !== -1);
    return curated.length ? curated : list.slice(0, 10);
  }

  /**
   * Wire the Settings style toggle buttons. One button per registered theme,
   * found by id ('settings-style-<themeId>'), so a new theme only needs its
   * own button in the markup.
   *
   * @returns {void}
   */
  function wireThemeControls() {
    if (!root.document || !root.document.getElementById) return;
    const buttons = [];
    listThemes().forEach((id) => {
      const btn = root.document.getElementById('settings-style-' + id);
      if (btn) buttons.push({ id, btn });
    });
    if (!buttons.length) return;

    const sync = () => {
      const active = getTheme();
      buttons.forEach((entry) => {
        const isActive = entry.id === active;
        const locked = isThemeLocked(entry.id);
        entry.btn.classList.toggle('active', isActive);
        entry.btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        // Kept clickable on purpose: the tap is what explains the lock.
        entry.btn.classList.toggle('locked', locked);
        entry.btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
      });
    };

    buttons.forEach((entry) => {
      entry.btn.addEventListener('click', () => {
        changeTheme(entry.id);
        sync();
      });
    });

    sync();
    root.document.addEventListener(THEME_EVENT, sync);
    root.document.addEventListener(THEME_LOCKED_EVENT, sync);
  }

  /* ------------------------------------------------------------------ *
   * Dice customisation (face style + colour), persisted in localStorage
   * and mirrored on <html data-dice-style / data-dice-color> so CSS and
   * render code can scope against them.
   * ------------------------------------------------------------------ */
  const DICE_STORAGE_KEY = 'mg_dice';
  const DICE_EVENT = 'mg:dicechange';
  const DICE_STYLES = ['numbers', 'classic', 'ancient'];
  const DICE_COLORS = ['white', 'black', 'red', 'cyan', 'pink'];

  /** Classic pip layouts, indices into a 3x3 grid (row-major). */
  const DICE_PIPS = {
    1: [4],
    2: [2, 6],
    3: [2, 4, 6],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };

  /**
   * Coerce raw dice preferences to a known { style, color } pair.
   *
   * @param {*} raw Parsed localStorage value (may be anything).
   * @returns {{style: string, color: string}}
   */
  function normalizeDicePref(raw) {
    let style = DICE_STYLES[0];
    let color = DICE_COLORS[0];
    if (raw && typeof raw === 'object') {
      if (DICE_STYLES.indexOf(raw.style) !== -1) style = raw.style;
      if (DICE_COLORS.indexOf(raw.color) !== -1) color = raw.color;
    }
    return { style, color };
  }

  /**
   * @returns {{style: string, color: string}} Persisted dice preferences.
   */
  function readDicePref() {
    let parsed = null;
    try {
      parsed = JSON.parse(root.localStorage.getItem(DICE_STORAGE_KEY));
    } catch (e) { /* ignore */ }
    return normalizeDicePref(parsed);
  }

  /**
   * Mirror dice preferences onto the document element.
   *
   * @param {{style: string, color: string}} pref
   * @returns {{style: string, color: string}}
   */
  function applyDicePref(pref) {
    const el = root.document && root.document.documentElement;
    if (!el) return pref;
    el.setAttribute('data-dice-style', pref.style);
    el.setAttribute('data-dice-color', pref.color);
    return pref;
  }

  /**
   * @returns {{style: string, color: string}} Current dice preferences.
   */
  function getDicePref() {
    return applyDicePref(readDicePref());
  }

  /**
   * @returns {string} Active dice face style id ('numbers'|'classic'|'ancient').
   */
  function getDiceStyle() {
    return readDicePref().style;
  }

  /**
   * @returns {string} Active dice colour id ('white'|'black'|'red'|'cyan'|'pink').
   */
  function getDiceColor() {
    return readDicePref().color;
  }

  /**
   * Persist and apply dice preferences, then notify listeners.
   *
   * @param {string} style Face style id.
   * @param {string} color Dice colour id.
   * @returns {{style: string, color: string}}
   */
  function setDice(style, color) {
    const pref = normalizeDicePref({
      style: style || undefined,
      color: color || undefined,
    });
    try {
      root.localStorage.setItem(DICE_STORAGE_KEY, JSON.stringify(pref));
    } catch (e) { /* ignore */ }
    applyDicePref(pref);
    if (root.document && typeof root.CustomEvent === 'function') {
      root.document.dispatchEvent(new root.CustomEvent(DICE_EVENT, { detail: pref }));
    }
    return pref;
  }

  /**
   * Apply the persisted dice preferences (used at startup).
   *
   * @returns {{style: string, color: string}}
   */
  function syncDice() {
    return applyDicePref(readDicePref());
  }

  /**
   * HTML for a die face: digits, Classic pips or the Ancient script digit.
   *
   * @param {number|string} value Face value 1-6.
   * @returns {string} Inner HTML for a .die element.
   */
  function diceFaceHtml(value) {
    const v = String(value);
    if (getTheme() === UI_CLASSIC) {
      return '<span class="die-face die-num">' + v + '</span>';
    }
    if (getDiceStyle() === 'classic') {
      const pips = (DICE_PIPS[value] || []).map((idx) => {
        const r = Math.floor(idx / 3) + 1;
        const c = (idx % 3) + 1;
        return '<i class="pip" style="grid-row:' + r + ';grid-column:' + c + '"></i>';
      }).join('');
      return '<span class="die-face die-pips">' + pips + '</span>';
    }
    if (getDiceStyle() === 'ancient') {
      return '<span class="die-face die-num ancient">' + v + '</span>';
    }
    return '<span class="die-face die-num">' + v + '</span>';
  }

  /**
   * Wire the Settings dice style/colour buttons. One button per option,
   * found by id ('settings-dice-style-<id>' / 'settings-dice-color-<id>').
   *
   * @returns {void}
   */
  function wireDiceControls() {
    if (!root.document || !root.document.getElementById) return;
    const styles = [];
    DICE_STYLES.forEach((id) => {
      const btn = root.document.getElementById('settings-dice-style-' + id);
      if (btn) styles.push({ id, btn });
    });
    const colors = [];
    DICE_COLORS.forEach((id) => {
      const btn = root.document.getElementById('settings-dice-color-' + id);
      if (btn) colors.push({ id, btn });
    });
    if (!styles.length && !colors.length) return;

    const sync = () => {
      const pref = readDicePref();
      styles.forEach((entry) => {
        const isActive = entry.id === pref.style;
        entry.btn.classList.toggle('active', isActive);
        entry.btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      colors.forEach((entry) => {
        const isActive = entry.id === pref.color;
        entry.btn.classList.toggle('active', isActive);
        entry.btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    };

    styles.forEach((entry) => {
      entry.btn.addEventListener('click', () => {
        setDice(entry.id, readDicePref().color);
        sync();
      });
    });
    colors.forEach((entry) => {
      entry.btn.addEventListener('click', () => {
        setDice(readDicePref().style, entry.id);
        sync();
      });
    });

    sync();
    root.document.addEventListener(DICE_EVENT, sync);
  }

  registerTheme({ id: UI_CLASSIC });
  registerTheme({
    id: UI_MODERN,
    requiresAuth: true,
    features: {
      goatArtwork: true,
      brandArtwork: true,
      roleTags: true,
      heldWash: true,
      climbAnimation: true,
      panelPlayerColor: true,
      curatedColorPicker: true,
    },
    icons: {
      pencil: PENCIL_ICON_SVG,
      trophy: TROPHY_ICON_SVG,
      copy: COPY_ICON_SVG,
    },
  });

  root.MGUi = Object.assign(root.MGUi || {}, {
    UI_STORAGE_KEY,
    UI_CLASSIC,
    UI_MODERN,
    THEME_EVENT,
    THEME_LOCKED_EVENT,
    DICE_STORAGE_KEY,
    DICE_EVENT,
    DICE_STYLES,
    DICE_COLORS,
    GOAT_COLORS,
    GOAT_INK,
    TEAM_GOAT_FOLDERS,
    TEAM_GOAT_IMAGE_BY_COLOR,
    COPY_ICON_SVG,
    PENCIL_ICON_SVG,
    TROPHY_ICON_SVG,
    registerTheme,
    listThemes,
    isKnownTheme,
    getTheme,
    getThemeConfig,
    themeFeatures,
    hasFeature,
    icon,
    botTagHtml,
    applyTheme,
    syncTheme,
    setTheme,
    changeTheme,
    emitThemeChange,
    wireThemeControls,
    themeRequiresAuth,
    isThemeLocked,
    setThemeAccess,
    // Older names kept so existing call sites keep working.
    getUiStyle: getTheme,
    setUiStyle: setTheme,
    isModern,
    modernPickerColors: pickerColors,
    pickerColors,
    goatSvg,
    goatImgUrl,
    goatImgHtml,
    hexToRgba,
    isLightColor,
    playerIconHtml,
    applyThemeDom,
    getDicePref,
    getDiceStyle,
    getDiceColor,
    setDice,
    syncDice,
    diceFaceHtml,
  });

  // Apply the persisted theme before paint (also set early in index.html).
  syncTheme();
  applyThemeDom();
  wireThemeControls();
  // Dice look (face style + colour) defaults to Numbers / white.
  syncDice();
  wireDiceControls();
})(window);
