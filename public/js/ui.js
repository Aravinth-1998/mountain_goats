/**
 * Mountain Goats — shared UI helpers: visual style (Classic / Modern) and
 * the coloured goat icon used by the Modern theme.
 */
(function (root) {
  const UI_STORAGE_KEY = 'mg_ui';
  const UI_CLASSIC = 'classic';
  const UI_MODERN = 'modern';

  /**
   * 10 vibrant goat colours — one per distinct goat image, all valid
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
   * Current visual style: 'classic' | 'modern'.
   *
   * @returns {string}
   */
  function getUiStyle() {
    try {
      if (localStorage.getItem(UI_STORAGE_KEY) === UI_MODERN) return UI_MODERN;
    } catch (e) { /* ignore */ }
    return UI_CLASSIC;
  }

  /**
   * Persist a visual style and apply it to <html>.
   *
   * @param {string} style 'classic' or 'modern'.
   * @returns {string}
   */
  function setUiStyle(style) {
    const next = style === UI_MODERN ? UI_MODERN : UI_CLASSIC;
    try {
      localStorage.setItem(UI_STORAGE_KEY, next);
    } catch (e) { /* ignore */ }
    root.document.documentElement.setAttribute('data-ui', next);
    return next;
  }

  /**
   * @returns {boolean}
   */
  function isModern() {
    return getUiStyle() === UI_MODERN;
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
   * Player icon (swatch): coloured goat image in Modern, letter coin in Classic.
   *
   * @param {string} color Player colour.
   * @param {string} name Player name (used for the Classic letter).
   * @param {string} [sizeClass] Extra swatch size class ('sm', ...).
   * @param {boolean} [markMe] Add the "me" styling hook.
   * @param {number} [teamId] Team id 0-2 (team-goat artwork).
   * @returns {string}
   */
  function playerIconHtml(color, name, sizeClass, markMe, teamId) {
    const cls = 'swatch'
      + (sizeClass ? ' ' + sizeClass : '')
      + (markMe ? ' me' : '');
    if (isModern()) {
      return '<span class="' + cls + ' goat-swatch">' + goatImgHtml(color, name, teamId) + '</span>';
    }
    return '<span class="' + cls + '" style="background:' + color + '">'
      + String((name || ' ').charAt(0)).toUpperCase()
      + '</span>';
  }

  /** Inline SVG for the copy-icon on the lobby room pill (replaces 📋 emoji). */
  const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'
    + '</svg>';

  /** Inline SVG pencil for the "edit colour" swatch badge (replaces ✏️ emoji). */
  const PENCIL_ICON_SVG = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
    + '<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'
    + '</svg>';

  /**
   * Swap the brand / loading goats for the Goat_title.png artwork in Modern,
   * and restore the original emoji in Classic.
   *
   * @returns {void}
   */
  function applyThemeDom() {
    root.document.querySelectorAll('.goat-emoji, .loading-goat').forEach((el) => {
      if (el.dataset.mgOriginal === undefined) {
        el.dataset.mgOriginal = el.innerHTML;
      }
      if (isModern()) {
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
   * Colours to offer in the Modern colour picker.
   *
   * @param {string[]} available Palette the server allows for this player.
   * @param {boolean} [keepAll] Keep every available shade (team palettes).
   * @returns {string[]}
   */
  function modernPickerColors(available, keepAll) {
    const list = (available && available.length) ? available : GOAT_COLORS;
    if (keepAll) return list.slice(0, 10);
    const curated = list.filter((c) => GOAT_COLORS.indexOf(c) !== -1);
    return curated.length ? curated : list.slice(0, 10);
  }

  /**
   * Wire the Settings → Style toggle buttons (Classic / Modern).
   *
   * @returns {void}
   */
  function wireSettingsStyle() {
    const buttons = root.document.querySelectorAll('#settings-style-classic, #settings-style-modern');
    if (!buttons.length) return;

    const sync = () => {
      const style = getUiStyle();
      buttons.forEach((btn) => {
        const isActive = btn.id === 'settings-style-' + style;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    };

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const style = btn.id === 'settings-style-modern' ? UI_MODERN : UI_CLASSIC;
        setUiStyle(style);
        applyThemeDom();
        sync();
        root.document.dispatchEvent(new root.CustomEvent('mg:stylechange', { detail: { style } }));
      });
    });

    sync();
    root.document.addEventListener('mg:stylechange', sync);
  }

  root.MGUi = Object.assign(root.MGUi || {}, {
    UI_STORAGE_KEY,
    UI_CLASSIC,
    UI_MODERN,
    GOAT_COLORS,
    GOAT_INK,
    TEAM_GOAT_FOLDERS,
    TEAM_GOAT_IMAGE_BY_COLOR,
    COPY_ICON_SVG,
    PENCIL_ICON_SVG,
    getUiStyle,
    setUiStyle,
    isModern,
    goatSvg,
    goatImgUrl,
    goatImgHtml,
    hexToRgba,
    isLightColor,
    playerIconHtml,
    applyThemeDom,
    modernPickerColors,
  });

  // Apply the persisted style before paint (also set early in index.html).
  root.document.documentElement.setAttribute('data-ui', getUiStyle());
  applyThemeDom();
  wireSettingsStyle();
})(window);
