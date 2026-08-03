/* Mountain Goats - client */
(async function () {
  /**
   * Stable per-tab id so the server can replace stale sockets on refresh.
   *
   * @returns {string}
   */
  function getPresenceId() {
    const storageKey = 'mg_presence_id';
    let presenceId = sessionStorage.getItem(storageKey);
    if (!presenceId) {
      presenceId = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(storageKey, presenceId);
    }
    return presenceId;
  }

  const presenceId = getPresenceId();
  const socket = io({
    closeOnBeforeunload: true,
    auth: { token: '', presenceId },
    transports: ['websocket'],
    upgrade: false,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  function disconnectSocketOnUnload() {
    socket.io.reconnection(false);
    socket.disconnect();
  }

  let socketAuthInFlight = null;
  let socketConnectionHasAuth = false;

  /**
   * Reconnect the socket with a JWT in the background after sign-in.
   *
   * @returns {void}
   */
  function scheduleSocketAuthReconnect() {
    if (!window.MGAuth || !isSignedIn()) return;
    ensureSocketAuth().catch((err) => {
      console.warn('[main] socket auth reconnect failed:', err);
    });
  }

  /**
   * Build a create/join payload with optional signed-in access token.
   *
   * @param {object} base Base event payload.
   * @returns {Promise<object>}
   */
  async function buildRoomPayload(base) {
    const payload = { ...base };
    if (window.MGAuth && isSignedIn()) {
      const token = await window.MGAuth.getAccessToken();
      if (token) payload.accessToken = token;
    }
    if (!socket.connected) {
      await new Promise((resolve) => {
        if (socket.connected) {
          resolve();
          return;
        }
        socket.once('connect', resolve);
        socket.connect();
      });
    }
    return payload;
  }

  /**
   * Ensure the socket handshake includes a signed-in JWT before gameplay emits.
   *
   * @returns {Promise<void>}
   */
  async function ensureSocketAuth() {
    if (!window.MGAuth || !isSignedIn()) return;
    if (socketAuthInFlight) return socketAuthInFlight;

    socketAuthInFlight = (async () => {
      const token = (await window.MGAuth.getAccessToken()) || '';
      if (!token) return;

      const hadToken = socket.auth.token;
      socket.auth.token = token;

      if (!socket.connected) {
        await new Promise((resolve) => {
          if (socket.connected) {
            resolve();
            return;
          }
          socket.once('connect', resolve);
          socket.connect();
        });
        return;
      }

      if (!socketConnectionHasAuth || hadToken !== token) {
        await new Promise((resolve) => {
          socket.once('connect', resolve);
          socket.once('disconnect', () => {
            socket.connect();
          });
          socket.disconnect();
        });
      }
    })().finally(() => {
      socketAuthInFlight = null;
    });

    return socketAuthInFlight;
  }

  socket.io.on('reconnect_attempt', async () => {
    if (window.MGAuth && isSignedIn()) {
      socket.auth.token = (await window.MGAuth.getAccessToken()) || '';
    } else {
      socket.auth.token = '';
    }
  });

  window.addEventListener('mg-auth-changed', async (event) => {
    if (!window.MGAuth || !event.detail) return;
    if (event.detail.shouldReconnect) {
      scheduleSocketAuthReconnect();
    }
    await refreshLobbyPresence();
    tryRejoin();
    applyInviteDeepLink();
  });

  let myId = null;
  let state = null;
  let lobbyWinsRefreshInFlight = false;
  const lobbyWinsRefreshAttempts = new Map();
  const selected = new Set(); // selected die indices for the current group
  /** @type {number|null} Die index with an open re-face picker, or null. */
  let refacePickerIndex = null;
  let selSig = '';
  let autoEndTimer = null; // timer for auto-ending turn when no groups possible
  let turnTimerLocalInterval = null;
  let colorPickerEl = null;
  let colorPickerOutsideHandler = null;
  let teamPickerEl = null;
  let teamPickerOutsideHandler = null;
  let teamPickerKeyHandler = null;
  let teamPickerRestore = null;
  let winCountUpFrames = [];
  let pendingMatchStats = null;
  let pendingSelfDiceRollAt = 0;

  const MAX_PLAYERS = 10;

  const PLAYER_COLORS = [
    // Red (dark -> light)
    '#9d0208',
    '#c1121f',
    '#e63946',
    '#ff5c5c',
    '#ff7a7a',
    // Blue (dark -> light)
    '#1e40af',
    '#1d4ed8',
    '#3b82f6',
    '#4f7cff',
    '#93c5fd',
    // Green (dark -> light)
    '#15803d',
    '#40916c',
    '#22c55e',
    '#06d6a0',
    '#86efac',
    // Other
    '#a855f7', // purple
    '#e67e22', // orange
    '#ec4899', // magenta
    '#92400e', // brown
    '#7c3aed', // violet
  ];

  const screens = {
    loading: document.getElementById('screen-loading'),
    home: document.getElementById('screen-home'),
    join: document.getElementById('screen-join'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    tutorial: document.getElementById('screen-tutorial'),
  };
  const $ = (id) => document.getElementById(id);

  if (window.MGHaptics) window.MGHaptics.init();
  if (window.MGSounds) window.MGSounds.init();

  /**
   * Resolve gaming name for create/join (signed-in input or guest input).
   *
   * @returns {string}
   */
  function getPlayName() {
    if (window.MGAuth) return window.MGAuth.getGamingNameForPlay();
    return $('home-name').value.trim();
  }

  /**
   * Returns true when the user signed in with Google.
   *
   * @returns {boolean}
   */
  function isSignedIn() {
    return !!(window.MGAuth && window.MGAuth.getAuthProfile().isSignedIn);
  }

  /**
   * Persist gaming name for signed-in users via Supabase Auth metadata.
   *
   * @param {string} name Resolved in-game name.
   */
  function persistSignedInGamingName(name) {
    if (window.MGAuth && isSignedIn() && name) {
      window.MGAuth.saveGamingName(name);
    }
  }

  /**
   * Store room rejoin keys after a successful create/join.
   *
   * @param {string} name Resolved in-game name.
   * @param {string} code Room code.
   */
  function storeRejoinKeys(name, code) {
    localStorage.setItem('mg_code', code);
    if (!isSignedIn()) {
      localStorage.setItem('mg_name', name);
    }
    persistSignedInGamingName(name);
  }

  /**
   * Validate guest name or return signed-in gaming name.
   *
   * @returns {string|null}
   */
  function requirePlayName() {
    const name = getPlayName();
    if (!name) {
      const nameInput = $('home-name');
      // Restart blink animation on each failed attempt.
      nameInput.classList.remove('input-error');
      void nameInput.offsetWidth;
      nameInput.classList.add('input-error');
      // Placeholder ("Enter your GOAT name") carries the empty-name cue in red.
      $('home-name-error').textContent = '';
      nameInput.focus();
      return null;
    }
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
    return name;
  }

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    document.documentElement.classList.toggle('mg-on-home', name === 'home');
    if (name !== 'loading') {
      document.documentElement.classList.remove('mg-rejoining');
    }
    if (name !== 'game') {
      clearLocalTurnTimer();
    }
    if (name === 'home') {
      const lbOverlay = document.getElementById('leaderboard-overlay');
      if (lbOverlay && lbOverlay.classList.contains('show')) {
        fetchLeaderboardIfNeeded();
      }
    }
  }

  // Saved room: stay on loading until lobby/game state arrives (no home flash).
  if (localStorage.getItem('mg_code')) {
    show('loading');
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /**
   * Normalize a raw invite value to a 4-digit room code.
   *
   * @param {*} raw Query param or pasted value.
   * @returns {string|null}
   */
  function normalizeInviteCode(raw) {
    const digits = String(raw == null ? '' : raw).replace(/\D/g, '').slice(0, 4);
    return digits.length === 4 ? digits : null;
  }

  /**
   * Read invite code from `?code=` or `?join=` in the current URL.
   *
   * @returns {string|null}
   */
  function parseInviteCodeFromLocation() {
    try {
      const params = new URLSearchParams(window.location.search);
      return normalizeInviteCode(params.get('code') || params.get('join'));
    } catch (err) {
      return null;
    }
  }

  /**
   * Strip invite query params so refresh does not re-open Join.
   *
   * @returns {void}
   */
  function clearInviteQueryFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('code') && !url.searchParams.has('join')) return;
      url.searchParams.delete('code');
      url.searchParams.delete('join');
      const qs = url.searchParams.toString();
      window.history.replaceState({}, '', url.pathname + (qs ? `?${qs}` : '') + url.hash);
    } catch (err) {
      // ignore
    }
  }

  /**
   * Build a shareable deep-link that opens Join with the room code prefilled.
   *
   * @param {string} code Room code.
   * @returns {string}
   */
  function buildInviteUrl(code) {
    const url = new URL(window.location.origin + (window.location.pathname || '/'));
    url.searchParams.set('code', String(code));
    return url.href;
  }

  /** @type {boolean} */
  let inviteDeepLinkHandled = false;

  /**
   * Prefill Join from an invite link and open that screen (unless rejoining a saved room).
   *
   * @returns {boolean} True when Join was opened from the invite.
   */
  function applyInviteDeepLink() {
    if (inviteDeepLinkHandled) return false;
    const code = parseInviteCodeFromLocation();
    if (!code) return false;

    const joinInput = $('join-code');
    if (joinInput) joinInput.value = code;
    clearInviteQueryFromUrl();
    inviteDeepLinkHandled = true;

    // Returning players reconnect via mg_code first; do not divert them to Join.
    if (localStorage.getItem('mg_code')) return false;
    if (state) return false;
    if (screens.lobby.classList.contains('active') || screens.game.classList.contains('active')) {
      return false;
    }

    show('join');
    refreshPublicRooms();
    startPublicRoomsRefresh();
    if (joinInput) {
      try { joinInput.focus(); } catch (err) { /* ignore */ }
    }
    return true;
  }

  /**
   * Convert a hex color to rgba with the given alpha.
   * Accepts #rgb or #rrggbb. Falls back to white at the given alpha.
   *
   * @param {string} hex Color string.
   * @param {number} alpha Opacity 0–1.
   * @returns {string}
   */
  function colorWithAlpha(hex, alpha) {
    const raw = String(hex || '').trim();
    const a = Math.max(0, Math.min(1, Number(alpha)));
    let h = raw.charAt(0) === '#' ? raw.slice(1) : raw;
    if (h.length === 3) {
      h = h.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) {
      return `rgba(255, 255, 255, ${a})`;
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /**
   * Parse #rgb/#rrggbb or rgb()/rgba() into components.
   *
   * @param {string} input CSS color string.
   * @returns {{r: number, g: number, b: number, a: number}|null}
   */
  function parseCssRgb(input) {
    if (!input) return null;
    const s = String(input).trim().toLowerCase();
    if (!s || s === 'transparent' || s === 'none') return null;
    let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (m) {
      let h = m[1];
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: 1,
      };
    }
    m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/);
    if (!m) return null;
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] != null ? Number(m[4]) : 1,
    };
  }

  /**
   * Blend a (possibly translucent) foreground onto an opaque hex background.
   *
   * @param {{r: number, g: number, b: number, a: number}} fg Foreground color.
   * @param {string} bgHex Opaque background hex.
   * @returns {string} #rrggbb
   */
  function blendOntoHex(fg, bgHex) {
    const bg = parseCssRgb(bgHex);
    if (!fg || !bg) return bgHex;
    const a = Math.max(0, Math.min(1, fg.a));
    if (a >= 0.999) {
      return '#' + [fg.r, fg.g, fg.b].map((n) => (
        Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
      )).join('');
    }
    const mix = (c, b) => Math.max(0, Math.min(255, Math.round(c * a + b * (1 - a))));
    return '#' + [mix(fg.r, bg.r), mix(fg.g, bg.g), mix(fg.b, bg.b)]
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Resolve a CSS background to an opaque hex over a base (html2canvas-safe).
   *
   * @param {string} cssBg Background color string.
   * @param {string} baseHex Opaque base hex.
   * @returns {string|null}
   */
  function flattenBgOver(cssBg, baseHex) {
    const parsed = parseCssRgb(cssBg);
    if (!parsed) return null;
    return blendOntoHex(parsed, baseHex);
  }

  /**
   * Read a swatch's solid fill. Prefers the inline style attribute hex so we
   * do not depend on `element.style.background` shorthand (often unparsable).
   *
   * @param {Element} el Swatch element.
   * @returns {string|null} #rrggbb or null.
   */
  function readSwatchSolidHex(el) {
    if (!el) return null;
    const attr = el.getAttribute('style') || '';
    const attrMatch = attr.match(/background(?:-color)?\s*:\s*([^;]+)/i);
    if (attrMatch) {
      const raw = attrMatch[1].trim();
      const hexMatch = raw.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/);
      if (hexMatch) {
        return blendOntoHex(parseCssRgb(hexMatch[0]), '#000000');
      }
      const parsed = parseCssRgb(raw);
      if (parsed) return blendOntoHex({ r: parsed.r, g: parsed.g, b: parsed.b, a: 1 }, '#000000');
    }
    const fromProp = parseCssRgb(el.style.backgroundColor);
    if (fromProp) return blendOntoHex({ r: fromProp.r, g: fromProp.g, b: fromProp.b, a: 1 }, '#000000');
    return null;
  }

  /**
   * Build a player colour coin for lobby / stats / results.
   *
   * @param {object} p Player.
   * @param {string} [sizeClass] Optional size class (e.g. "sm").
   * @param {{markMe?: boolean}} [options] Pass markMe:false to keep a circle for the local player.
   * @returns {string} HTML
   */
  function playerCoinHtml(p, sizeClass, options) {
    const markMe = !(options && options.markMe === false);
    const cls = 'swatch'
      + (sizeClass ? ' ' + sizeClass : '')
      + (markMe && p.id === myId ? ' me' : '');
    return `<span class="${cls}" style="background:${p.color}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>`;
  }
  function lobbyPlayerEndIconHtml(p) {
    if (p.id === state.hostId) {
      return `<span class="host-icon" title="Host">👑</span>`;
    }
    if (p.isBot) {
      return `<span class="player-type-icon bot" title="Bot">🤖</span>`;
    }
    return '';
  }
  function canPickLobbyColor(p) {
    return p.id === myId || (state && state.hostId === myId);
  }
  function lobbySwatchHtml(p) {
    const clickable = canPickLobbyColor(p) ? ' swatch-clickable' : '';
    const title = clickable
      ? (p.id === myId ? 'Change colour' : `Change ${p.name}'s colour`)
      : '';
    const pen = clickable
      ? '<span class="swatch-edit" aria-hidden="true">&#9999;&#65039;</span>'
      : '';
    return `<span class="swatch${p.id === myId ? ' me' : ''}${clickable}" style="background:${p.color}"${clickable ? ` role="button" tabindex="0" title="${escapeHtml(title)}"` : ''}>${escapeHtml(p.name.charAt(0).toUpperCase())}${pen}</span>`;
  }
  function lobbyWinsBadgeHtml(p) {
    if (typeof p.totalWins === 'number' && p.totalWins > 0) {
      return `<span class="badge wins" title="${p.totalWins} overall win${p.totalWins === 1 ? '' : 's'}">&#127942; ${p.totalWins}</span>`;
    }
    return '';
  }
  function lobbyPlayerBadgesHtml(p, extraBadge) {
    return lobbyWinsBadgeHtml(p) + (extraBadge || '');
  }
  function lobbyPlayerRowHtml(p, badgeHtml) {
    const badge = badgeHtml || '';
    return `<div class="player-main">${lobbySwatchHtml(p)}<span class="player-name">${escapeHtml(p.name)}</span></div><div class="player-end">${badge}${lobbyPlayerEndIconHtml(p)}</div>`;
  }
  /** @returns {object} Active client mode module for current state. */
  function currentMode() {
    return GameModes.getModeForState(state);
  }
  function getPlayerColors(p) {
    return currentMode().getPlayerColors(state, p, PLAYER_COLORS);
  }
  function closeColorPicker() {
    if (colorPickerEl) {
      colorPickerEl.remove();
      colorPickerEl = null;
    }
    if (colorPickerOutsideHandler) {
      document.removeEventListener('click', colorPickerOutsideHandler);
      colorPickerOutsideHandler = null;
    }
  }
  /**
   * Close the lobby team-change picker if open.
   *
   * @returns {void}
   */
  function closeTeamPicker() {
    if (teamPickerRestore) {
      const { row, html, title, amHost } = teamPickerRestore;
      row.innerHTML = html;
      row.classList.remove('team-picker-source', 'team-move-bar');
      row.title = title || 'Change team';
      row.querySelectorAll('.kick-btn, .team-switch-btn').forEach((btn) => btn.remove());
      const p = state && state.players.find((pl) => pl.id === row.dataset.playerId);
      if (p) {
        appendTeamSwitchBtn(row, p, amHost);
        appendKickBtn(row, p, amHost);
        attachLobbySwatch(row, p);
      }
      teamPickerRestore = null;
    }
    teamPickerEl = null;
    if (teamPickerOutsideHandler) {
      document.removeEventListener('click', teamPickerOutsideHandler);
      teamPickerOutsideHandler = null;
    }
    if (teamPickerKeyHandler) {
      document.removeEventListener('keydown', teamPickerKeyHandler);
      teamPickerKeyHandler = null;
    }
  }
  let colorApplyLock = false;
  function applyLobbyColor(color, playerId) {
    if (colorApplyLock || !state) return;
    const player = state.players.find((pl) => pl.id === playerId);
    if (!player || player.color === color) {
      closeColorPicker();
      return;
    }
    colorApplyLock = true;
    closeColorPicker();
    socket.emit('setPlayerColor', { color, playerId }, (res) => {
      colorApplyLock = false;
      if (res && res.error) toast(res.error);
    });
  }
  function openColorPicker(anchor, p) {
    closeTeamPicker();
    closeColorPicker();
    const usedByOthers = new Set(state.players.filter((pl) => pl.id !== p.id).map((pl) => pl.color));
    const pop = document.createElement('div');
    pop.className = 'color-picker-pop';
    pop.dataset.playerId = p.id;
    const grid = document.createElement('div');
    grid.className = 'color-picker-grid';
    getPlayerColors(p).forEach((color) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-opt';
      btn.style.background = color;
      btn.dataset.color = color;
      const taken = usedByOthers.has(color);
      if (taken) {
        btn.classList.add('taken');
        btn.disabled = true;
        btn.innerHTML = '<span class="color-opt-x">X</span>';
      } else {
        if (p.color === color) btn.classList.add('current');
        const pickColor = (e) => {
          e.preventDefault();
          e.stopPropagation();
          applyLobbyColor(color, p.id);
        };
        btn.addEventListener('click', pickColor);
        btn.addEventListener('touchend', pickColor, { passive: false });
      }
      grid.appendChild(btn);
    });
    pop.appendChild(grid);
    pop.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(pop);
    colorPickerEl = pop;
    const rect = anchor.getBoundingClientRect();
    const popW = pop.offsetWidth;
    const popH = pop.offsetHeight;
    let top = rect.bottom + 8;
    let left = rect.left;
    if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
    if (left < 8) left = 8;
    if (top + popH > window.innerHeight - 8) top = rect.top - popH - 8;
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
    setTimeout(() => {
      colorPickerOutsideHandler = (e) => {
        if (e.target.closest('.color-picker-pop') || e.target.closest('.swatch-clickable')) return;
        closeColorPicker();
      };
      document.addEventListener('click', colorPickerOutsideHandler);
    }, 0);
  }
  function attachLobbySwatch(li, p) {
    if (!canPickLobbyColor(p)) return;
    const swatch = li.querySelector('.swatch-clickable');
    if (!swatch) return;
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (colorPickerEl) closeColorPicker();
      else openColorPicker(swatch, p);
    };
    // Stop team-row click from opening the team picker when changing colour.
    swatch.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    swatch.addEventListener('click', open);
    swatch.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  }
  function lobbyPlayerEndBeforeIcon(parent) {
    const end = parent.querySelector('.player-end');
    if (!end) return null;
    return end.querySelector('.host-icon, .player-type-icon');
  }
  function appendKickBtn(parent, p, amHost) {
    if (!amHost || p.id === myId) return;
    const end = parent.querySelector('.player-end');
    if (!end) return;
    const x = document.createElement('button');
    x.className = 'kick-btn';
    x.textContent = '✕';
    x.title = p.isBot ? 'Remove bot' : 'Kick player';
    x.addEventListener('click', () => socket.emit('kickPlayer', { id: p.id }));
    end.appendChild(x);
  }
  /**
   * Add a Switch control that opens the lobby team picker for a movable player.
   *
   * @param {HTMLElement} parent Team member row.
   * @param {object} p Player.
   * @param {boolean} amHost Whether local user is host.
   * @returns {void}
   */
  function appendTeamSwitchBtn(parent, p, amHost) {
    if (!canMoveTeamPlayer(p.id, amHost) || !state || !state.teams || !state.teams.length) return;
    const end = parent.querySelector('.player-end');
    if (!end || end.querySelector('.team-switch-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'team-switch-btn';
    btn.textContent = '⇄';
    btn.title = 'Change team';
    btn.setAttribute('aria-label', `Change team for ${p.name}`);
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const playerId = parent.dataset.playerId || p.id;
      if (teamPickerEl && teamPickerEl.dataset.playerId === playerId) {
        closeTeamPicker();
        return;
      }
      const fromTeamId = parent.dataset.fromTeamId != null && parent.dataset.fromTeamId !== ''
        ? Number(parent.dataset.fromTeamId)
        : null;
      openTeamPicker(parent, playerId, fromTeamId);
    });
    const kick = end.querySelector('.kick-btn');
    if (kick) {
      end.insertBefore(btn, kick);
      return;
    }
    const icon = end.querySelector('.host-icon, .player-type-icon');
    if (icon) end.insertBefore(btn, icon);
    else end.appendChild(btn);
  }

  // Enforce 4-digit limit on room code inputs
  $('join-code').addEventListener('input', function() {
    if (this.value.length > 4) this.value = this.value.slice(0, 4);
  });

  // Public rooms refresh timer
  let publicRoomsTimer = null;
  let leaderboardFetchedAt = 0;
  const LEADERBOARD_REFRESH_MS = 60000;

  // ===================== HOW TO PLAY / OVERLAYS =====================
  document.querySelectorAll('.rules-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const content = document.getElementById(targetId);
      if (!content) return;
      const isOpen = content.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  });

  /**
   * Open or close the How to Play popup.
   *
   * @param {boolean} open Whether the popup should be visible.
   * @returns {void}
   */
  function setHowtoOverlayOpen(open) {
    const overlay = $('howto-overlay');
    if (!overlay) return;
    overlay.classList.toggle('show', !!open);
    if (open) {
      overlay.removeAttribute('hidden');
      const tutBtn = $('btn-play-tutorial');
      if (tutBtn) {
        const onHome = !!(screens.home && screens.home.classList.contains('active'));
        tutBtn.hidden = !onHome;
      }
    } else {
      overlay.setAttribute('hidden', '');
    }
  }

  /**
   * Open or close the Leaderboard popup.
   *
   * @param {boolean} open Whether the popup should be visible.
   * @returns {void}
   */
  function setLeaderboardOverlayOpen(open) {
    const overlay = $('leaderboard-overlay');
    if (!overlay) return;
    const isOpen = !!open;
    overlay.classList.toggle('show', isOpen);
    if (isOpen) overlay.removeAttribute('hidden');
    else overlay.setAttribute('hidden', '');
    const btn = $('btn-leaderboard');
    if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) fetchLeaderboardIfNeeded();
  }

  /**
   * Open or close the Settings popup.
   *
   * @param {boolean} open Whether the popup should be visible.
   * @returns {void}
   */
  function setSettingsOverlayOpen(open) {
    const overlay = $('settings-overlay');
    if (!overlay) return;
    const isOpen = !!open;
    overlay.classList.toggle('show', isOpen);
    if (isOpen) overlay.removeAttribute('hidden');
    else overlay.setAttribute('hidden', '');
    document.querySelectorAll('#btn-settings, #btn-settings-lobby, #btn-settings-game').forEach((btn) => {
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });
  }

  const btnHowtoClose = $('btn-howto-close');
  if (btnHowtoClose) {
    btnHowtoClose.addEventListener('click', () => setHowtoOverlayOpen(false));
  }
  document.querySelectorAll('#btn-howto, #btn-howto-lobby, #btn-howto-game').forEach((btn) => {
    btn.addEventListener('click', () => setHowtoOverlayOpen(true));
  });
  const howtoOverlay = $('howto-overlay');
  if (howtoOverlay) {
    howtoOverlay.addEventListener('click', (e) => {
      if (e.target === howtoOverlay) setHowtoOverlayOpen(false);
    });
  }

  const btnLeaderboard = $('btn-leaderboard');
  if (btnLeaderboard) {
    btnLeaderboard.addEventListener('click', () => setLeaderboardOverlayOpen(true));
  }
  const btnLeaderboardClose = $('btn-leaderboard-close');
  if (btnLeaderboardClose) {
    btnLeaderboardClose.addEventListener('click', () => setLeaderboardOverlayOpen(false));
  }
  const leaderboardOverlay = $('leaderboard-overlay');
  if (leaderboardOverlay) {
    leaderboardOverlay.addEventListener('click', (e) => {
      if (e.target === leaderboardOverlay) setLeaderboardOverlayOpen(false);
    });
  }

  const btnSettingsClose = $('btn-settings-close');
  if (btnSettingsClose) {
    btnSettingsClose.addEventListener('click', () => setSettingsOverlayOpen(false));
  }
  document.querySelectorAll('#btn-settings, #btn-settings-lobby, #btn-settings-game').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', () => setSettingsOverlayOpen(true));
  });
  const settingsOverlay = $('settings-overlay');
  if (settingsOverlay) {
    settingsOverlay.addEventListener('click', (e) => {
      if (e.target === settingsOverlay) setSettingsOverlayOpen(false);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (settingsOverlay && settingsOverlay.classList.contains('show')) {
      setSettingsOverlayOpen(false);
      return;
    }
    if (leaderboardOverlay && leaderboardOverlay.classList.contains('show')) {
      setLeaderboardOverlayOpen(false);
      return;
    }
    if (howtoOverlay && howtoOverlay.classList.contains('show')) {
      setHowtoOverlayOpen(false);
    }
  });

  document.querySelectorAll('.rules-content').forEach((panel) => {
    panel.addEventListener('click', (e) => {
      const tab = e.target.closest('.rules-tab');
      if (!tab || !panel.contains(tab)) return;
      const mode = tab.getAttribute('data-rules-tab');
      if (!mode) return;
      panel.querySelectorAll('.rules-tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panel.querySelectorAll('.rules-pane').forEach((pane) => {
        const on = pane.getAttribute('data-rules-pane') === mode;
        pane.classList.toggle('is-active', on);
        pane.hidden = !on;
      });
    });
  });

  /**
   * Build a fallback avatar URL for leaderboard rows.
   *
   * @param {string} name Display name.
   * @returns {string}
   */
  function leaderboardAvatarFallback(name) {
    const encoded = encodeURIComponent(name || 'Player');
    return `https://ui-avatars.com/api/?name=${encoded}&background=4f7cff&color=fff&size=56`;
  }

  /**
   * Render leaderboard entries in the home panel.
   *
   * @param {Array<object>} entries Leaderboard rows from the API.
   */
  function renderLeaderboard(entries) {
    const list = $('leaderboard-list');
    const emptyEl = $('leaderboard-empty');
    const errorEl = $('leaderboard-error');
    const headerEl = $('leaderboard-header');
    if (!list || !emptyEl || !errorEl) return;

    list.innerHTML = '';
    errorEl.hidden = true;
    errorEl.textContent = '';
    if (headerEl) headerEl.hidden = false;

    if (!entries || entries.length === 0) {
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row' + (entry.isMe ? ' is-me' : '') + (entry.rank === 1 ? ' rank-1' : '');
      row.setAttribute('role', 'listitem');

      const rank = document.createElement('span');
      rank.className = 'leaderboard-rank';
      rank.textContent = String(entry.rank);

      const img = document.createElement('img');
      img.className = 'leaderboard-avatar';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.loading = 'lazy';
      const fallback = leaderboardAvatarFallback(entry.name);
      img.onerror = () => {
        img.onerror = null;
        img.src = fallback;
      };
      img.src = entry.avatarUrl || fallback;

      const name = document.createElement('span');
      name.className = 'leaderboard-name';
      name.textContent = entry.name || 'Player';

      const wins = document.createElement('span');
      wins.className = 'leaderboard-wins';
      wins.textContent = String(entry.wins);

      row.appendChild(rank);
      row.appendChild(img);
      row.appendChild(name);
      row.appendChild(wins);
      list.appendChild(row);
    });
  }

  /**
   * Fetch leaderboard data when the panel is opened or stale.
   *
   * @returns {Promise<void>}
   */
  async function fetchLeaderboardIfNeeded() {
    const list = $('leaderboard-list');
    const emptyEl = $('leaderboard-empty');
    const errorEl = $('leaderboard-error');
    const headerEl = $('leaderboard-header');
    if (!list || !emptyEl || !errorEl) return;

    const now = Date.now();
    if (leaderboardFetchedAt && now - leaderboardFetchedAt < LEADERBOARD_REFRESH_MS && list.children.length) {
      return;
    }

    emptyEl.hidden = true;
    errorEl.hidden = true;
    errorEl.textContent = '';
    if (headerEl) headerEl.hidden = true;
    list.innerHTML = '';
    const loader = window.MGUi && window.MGUi.createInlineLoader('Loading leaderboard...');
    if (loader) {
      list.appendChild(loader);
    } else {
      list.innerHTML = '<p class="leaderboard-loading">Loading leaderboard...</p>';
    }

    let url = '/api/leaderboard';
    if (window.MGAuth) {
      const profile = window.MGAuth.getAuthProfile();
      if (profile && profile.isSignedIn && profile.userId) {
        url += `?viewerId=${encodeURIComponent(profile.userId)}`;
      }
    }

    try {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        list.innerHTML = '';
        if (headerEl) headerEl.hidden = false;
        errorEl.textContent = data.error || 'Data is not currently available.';
        errorEl.hidden = false;
        return;
      }
      leaderboardFetchedAt = Date.now();
      renderLeaderboard(data.entries || []);
    } catch (err) {
      list.innerHTML = '';
      if (headerEl) headerEl.hidden = false;
      errorEl.textContent = 'Data is not currently available.';
      errorEl.hidden = false;
    }
  }

  // Clear error styling when user clicks or types in the name field
  function clearHomeNameError() {
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
  }
  $('home-name').addEventListener('pointerdown', clearHomeNameError);
  $('home-name').addEventListener('input', clearHomeNameError);

  // ===================== HOME =====================
  $('btn-create').addEventListener('click', async () => {
    const name = requirePlayName();
    if (!name) return;
    $('home-error').textContent = '';
    setHomeLoading('create');
    try {
      const payload = await buildRoomPayload({ name });
      socket.emit('createRoom', payload, (res) => {
        clearHomeLoading();
        if (res.error) return ($('home-error').textContent = res.error);
        leftRoom = false;
        scorecardHold = false;
        waitingForLobbyAfterDismiss = false;
        clearScorecardDone(res.code);
        myId = res.youId;
        storeRejoinKeys(name, res.code);
      });
    } catch (err) {
      clearHomeLoading();
      $('home-error').textContent = 'Could not create room. Please try again.';
      console.error('[main] createRoom failed:', err);
    }
  });

  // Navigate to Join screen
  $('btn-goto-join').addEventListener('click', () => {
    const name = requirePlayName();
    if (!name) return;
    $('home-error').textContent = '';
    show('join');
    refreshPublicRooms();
    startPublicRoomsRefresh();
  });

  $('btn-play-tutorial').addEventListener('click', () => {
    if (!window.MGTutorial) return;
    setHowtoOverlayOpen(false);
    window.MGTutorial.start({
      showScreen: show,
      goHome: () => show('home'),
    });
  });

  // Join screen back button
  $('join-back').addEventListener('click', () => {
    stopPublicRoomsRefresh();
    show('home');
  });

  // Join Room (from join screen)
  $('btn-join').addEventListener('click', async () => {
    const name = getPlayName();
    const code = String($('join-code').value || '').trim().slice(0, 4);
    if (!name) return ($('join-error').textContent = 'Please enter your name on the home screen.');
    if (!code || code.length < 4) return ($('join-error').textContent = 'Please enter the 4-digit room code.');
    $('join-error').textContent = '';
    $('btn-join').disabled = true;
    $('btn-join').innerHTML = '<span class="spin">⏳</span> Joining…';
    try {
      const payload = await buildRoomPayload({ name, code });
      socket.emit('joinRoom', payload, (res) => {
        $('btn-join').disabled = false;
        $('btn-join').textContent = 'Join Room';
        if (res.error) return ($('join-error').textContent = res.error);
        leftRoom = false;
        scorecardHold = false;
        waitingForLobbyAfterDismiss = false;
        myId = res.youId;
        storeRejoinKeys(name, res.code);
        stopPublicRoomsRefresh();
      });
    } catch (err) {
      $('btn-join').disabled = false;
      $('btn-join').textContent = 'Join Room';
      $('join-error').textContent = 'Could not join room. Please try again.';
      console.error('[main] joinRoom failed:', err);
    }
  });

  function setHomeLoading(which) {
    const actions = document.querySelector('.home-actions');
    if (actions) actions.classList.add('is-loading');
    $('btn-create').disabled = true;
    $('btn-goto-join').disabled = true;
    $('home-error').textContent = '';
    if (which === 'create') $('btn-create').innerHTML = '<span class="spin">⏳</span> Creating…';
  }
  function clearHomeLoading() {
    const actions = document.querySelector('.home-actions');
    if (actions) actions.classList.remove('is-loading');
    $('btn-create').disabled = false;
    $('btn-goto-join').disabled = false;
    $('btn-create').textContent = 'Create Room';
  }

  // ===================== PUBLIC ROOMS =====================
  function refreshPublicRooms() {
    socket.emit('getPublicRooms', {}, (rooms) => {
      const list = $('public-rooms-list');
      list.innerHTML = '';
      if (!rooms || rooms.length === 0) {
        list.innerHTML = '<p class="muted center">No public rooms available right now.</p>';
        return;
      }
      rooms.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'public-room-card';
        const full = r.playerCount >= r.maxPlayers;
        card.innerHTML = `
          <div class="pr-info">
            <span class="pr-host">🐐 ${escapeHtml(r.hostName)}</span>
            <span class="pr-meta">${r.playerCount}/${r.maxPlayers} players · ${GameModes.getModeForState(r).roomsListLabel(r)}</span>
          </div>
          <button class="btn btn-join btn-sm pr-join" ${full ? 'disabled' : ''} data-code="${r.code}">${full ? 'Full' : 'Join'}</button>
        `;
        const joinBtn = card.querySelector('.pr-join');
        if (!full) {
          joinBtn.addEventListener('click', async () => {
            const name = getPlayName();
            if (!name) return ($('join-error').textContent = 'Please enter your name on the home screen.');
            $('join-error').textContent = '';
            joinBtn.disabled = true;
            joinBtn.innerHTML = '<span class="spin">⏳</span>';
            try {
              const payload = await buildRoomPayload({ name, code: r.code });
              socket.emit('joinRoom', payload, (res) => {
                joinBtn.disabled = false;
                joinBtn.textContent = 'Join';
                if (res.error) return ($('join-error').textContent = res.error);
                leftRoom = false;
                scorecardHold = false;
                waitingForLobbyAfterDismiss = false;
                myId = res.youId;
                storeRejoinKeys(name, res.code);
                stopPublicRoomsRefresh();
              });
            } catch (err) {
              joinBtn.disabled = false;
              joinBtn.textContent = 'Join';
              $('join-error').textContent = 'Could not join room. Please try again.';
              console.error('[main] public joinRoom failed:', err);
            }
          });
        }
        list.appendChild(card);
      });
    });
  }

  let publicRoomsWasActive = false;
  function startPublicRoomsRefresh() {
    stopPublicRoomsRefresh();
    publicRoomsWasActive = true;
    publicRoomsTimer = setInterval(refreshPublicRooms, 4000);
  }
  function stopPublicRoomsRefresh() {
    if (publicRoomsTimer) { clearInterval(publicRoomsTimer); publicRoomsTimer = null; }
    publicRoomsWasActive = false;
  }

  // Invite link: ?code=1234 (or ?join=1234) opens Join with the code prefilled.
  applyInviteDeepLink();

  // Pause background work (interval repaints, CSS animations, room polling) while
  // the tab is hidden — the browser throttles timers but not enough on mobile
  // to keep the device cool. Resume on return.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      document.body.classList.add('tab-hidden');
      if (publicRoomsTimer) { clearInterval(publicRoomsTimer); publicRoomsTimer = null; }
      if (turnTimerLocalInterval) { clearInterval(turnTimerLocalInterval); turnTimerLocalInterval = null; }
    } else {
      document.body.classList.remove('tab-hidden');
      if (publicRoomsWasActive && !publicRoomsTimer) {
        try { refreshPublicRooms(); } catch (e) {}
        publicRoomsTimer = setInterval(refreshPublicRooms, 4000);
      }
      if (state && state.started && !state.finished) {
        try { syncTurnTimerDisplay(); } catch (e) {}
      }
    }
  });

  // ===================== LOBBY ROOM SETTINGS =====================
  $('btn-private').addEventListener('click', () => {
    socket.emit('setRoomVisibility', { isPublic: false });
  });
  $('btn-public').addEventListener('click', () => {
    socket.emit('setRoomVisibility', { isPublic: true });
  });
  $('btn-maxp-down').addEventListener('click', () => {
    if (!state) return;
    const cur = state.maxPlayers || MAX_PLAYERS;
    if (cur > 2) socket.emit('setMaxPlayers', { maxPlayers: cur - 1 });
  });
  $('btn-maxp-up').addEventListener('click', () => {
    if (!state) return;
    const cur = state.maxPlayers || MAX_PLAYERS;
    if (cur < MAX_PLAYERS) socket.emit('setMaxPlayers', { maxPlayers: cur + 1 });
  });

  const TURN_TIME_OPTIONS = [0, 10, 15, 20, 30, 45, 60];

  /**
   * Format turn timer seconds for the lobby display.
   * @param {number} sec
   * @returns {string}
   */
  function formatTurnTimeSec(sec) {
    return `${sec || 0}s`;
  }

  /**
   * Index of the current turn timer option (defaults to 0s).
   * @returns {number}
   */
  function turnTimeOptionIndex() {
    const cur = state ? (state.turnTimeSec || 0) : 0;
    const idx = TURN_TIME_OPTIONS.indexOf(cur);
    return idx >= 0 ? idx : 0;
  }

  $('btn-turn-timer-down').addEventListener('click', () => {
    if (!state) return;
    const idx = turnTimeOptionIndex();
    if (idx <= 0) return;
    socket.emit('setTurnTimer', { turnTimeSec: TURN_TIME_OPTIONS[idx - 1] });
  });
  $('btn-turn-timer-up').addEventListener('click', () => {
    if (!state) return;
    const idx = turnTimeOptionIndex();
    if (idx >= TURN_TIME_OPTIONS.length - 1) return;
    socket.emit('setTurnTimer', { turnTimeSec: TURN_TIME_OPTIONS[idx + 1] });
  });

  // ===================== LOBBY / NAV =====================
  $('btn-start').addEventListener('click', () => socket.emit('startGame'));
  $('btn-addbot').addEventListener('click', () => socket.emit('addBot'));
  // Game mode controls (via client mode registry)
  $('btn-teams-off').addEventListener('click', () => {
    if (!state || currentMode().id === 'standard') return;
    GameModes.getMode('standard').emitSetMode(socket);
  });
  $('btn-teams-on').addEventListener('click', () => {
    if (!state || currentMode().id === 'standardTeam') return;
    GameModes.getMode('standardTeam').emitSetMode(socket);
  });
  $('btn-2teams').addEventListener('click', () => socket.emit('setTeamConfig', { numTeams: 2 }));
  $('btn-3teams').addEventListener('click', () => socket.emit('setTeamConfig', { numTeams: 3 }));

  // Leave buttons open the confirm popup
  $('lobby-leave').addEventListener('click', () => askLeave(false));
  $('game-leave').addEventListener('click', () => askLeave(true));

  // Room code copy on tap
  $('lobby-pill').addEventListener('click', copyRoomCode);
  $('lobby-share').addEventListener('click', shareRoom);

  // Leave confirm popup
  $('btn-leave-cancel').addEventListener('click', () => $('leave-overlay').classList.remove('show'));
  $('btn-leave-confirm').addEventListener('click', () => {
    $('leave-overlay').classList.remove('show');
    leaveToHome();
  });

  function askLeave(inGame) {
    const heading = document.querySelector('#leave-overlay h2');
    if (heading) heading.textContent = inGame ? 'Leave the game?' : 'Leave the lobby?';
    $('leave-msg').textContent = inGame
      ? 'Your goats will stay put, but your turn will be skipped.'
      : '';
    $('leave-overlay').classList.add('show');
  }

  function copyRoomCode() {
    if (!state) return;
    const code = state.code;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => toast(`Room code ${code} copied!`));
    } else {
      toast('Room code: ' + code);
    }
  }

  /**
   * Prepare a cloned win card for html2canvas so entrance animations and
   * count-up zeros do not produce a blank or partial screenshot.
   * Also bakes translucent colors to opaque hex — html2canvas often composites
   * rgba against the wrong backdrop, which washes out team/player colours.
   *
   * @param {Document} clonedDoc Document clone passed to html2canvas onclone.
   * @returns {void}
   */
  function prepareWinCardClone(clonedDoc) {
    if (!clonedDoc) return;
    const card = clonedDoc.querySelector('#win-overlay .overlay-card')
      || clonedDoc.querySelector('.overlay-card');
    if (!card) return;

    const SHARE_CARD_BG = '#1c2743';
    const view = clonedDoc.defaultView;

    const actions = card.querySelector('.win-actions');
    if (actions) actions.style.display = 'none';

    const animated = card.querySelectorAll(
      '.win-head, .trophy, .score-row, .win-extra, .overlay-card, .win-rival-side, .win-pod, .win-bar-track'
    );
    animated.forEach((el) => {
      el.style.animation = 'none';
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    card.style.animation = 'none';
    card.style.opacity = '1';
    card.style.transform = 'none';

    // Opaque card matching the perceived on-screen tone (live UI is translucent
    // --card over the dark overlay/body gradient).
    card.style.setProperty('background', SHARE_CARD_BG, 'important');
    card.style.setProperty('background-color', SHARE_CARD_BG, 'important');
    card.style.borderColor = 'rgba(255,255,255,0.10)';
    card.style.color = '#eaf0ff';

    /**
     * @param {Element} el
     * @returns {string}
     */
    function readBg(el) {
      const inline = el.style.backgroundColor || el.style.background;
      if (inline && inline !== 'none' && inline !== 'initial') return inline;
      if (!view || !view.getComputedStyle) return '';
      try {
        return view.getComputedStyle(el).backgroundColor || '';
      } catch (err) {
        return '';
      }
    }

    /**
     * @param {Element} el
     * @param {string} hex
     * @returns {void}
     */
    function setOpaqueBg(el, hex) {
      el.style.setProperty('background', hex, 'important');
      el.style.setProperty('background-color', hex, 'important');
    }

    // Flatten translucent row / panel fills onto the opaque card.
    card.querySelectorAll(
      '.score-row, .end-reason, .sb-bonus, .win-rival-side, .win-pod-height, .win-bar-track, .win-bar-seg'
    ).forEach((el) => {
      const flat = flattenBgOver(readBg(el), SHARE_CARD_BG);
      if (flat) setOpaqueBg(el, flat);
    });

    // Winner rows: gold tint matching .score-row.win (15% #ffd166 over card).
    card.querySelectorAll('.score-row.win').forEach((el) => {
      setOpaqueBg(el, blendOntoHex({ r: 255, g: 209, b: 102, a: 0.15 }, SHARE_CARD_BG));
      el.style.setProperty('color', '#ffd166', 'important');
      el.style.setProperty('border-color', 'rgba(255, 209, 102, 0.4)', 'important');
    });
    card.querySelectorAll('.score-row:not(.win)').forEach((el) => {
      setOpaqueBg(el, blendOntoHex({ r: 255, g: 255, b: 255, a: 0.05 }, SHARE_CARD_BG));
    });
    card.querySelectorAll('.score-row:not(.win) .sb-right').forEach((el) => {
      el.style.setProperty('color', '#93a0bf', 'important');
    });
    card.querySelectorAll('.score-row.win .sb-right').forEach((el) => {
      el.style.setProperty('color', '#ffd166', 'important');
    });

    // Player coins: rewrite style entirely. .me uses a square radius that
    // html2canvas often paints as a second fill (circle + square = two shades).
    card.querySelectorAll('.swatch').forEach((el) => {
      const solid = readSwatchSolidHex(el) || flattenBgOver(readBg(el), SHARE_CARD_BG);
      if (!solid) return;
      el.classList.remove('me');
      el.setAttribute(
        'style',
        [
          `background:${solid}`,
          `background-color:${solid}`,
          'color:#08101f',
          'border-radius:50%',
          'border:1px solid rgba(255,255,255,0.22)',
          'box-shadow:0 1px 3px rgba(0,0,0,0.45)',
        ].join(';')
      );
    });

    const overlay = clonedDoc.getElementById('win-overlay');
    if (overlay) {
      overlay.style.animation = 'none';
      overlay.style.opacity = '1';
      overlay.style.transform = 'none';
    }

    card.querySelectorAll('.sb-count-score').forEach((el) => {
      if (el.dataset.target != null && el.dataset.target !== '') {
        el.textContent = el.dataset.target;
      }
    });
  }

  function shareWinResult() {
    if (!state) return;
    const share = currentMode().shareLines(state);
    const standings = share.standings;

    const text = `${standings}\n\nPlay at: ${location.origin}`;

    // Try to capture the overlay card as an image
    const overlayCard = document.querySelector('#win-overlay .overlay-card');
    if (overlayCard && typeof html2canvas === 'function') {
      // Temporarily hide the action buttons for a cleaner screenshot
      const actions = overlayCard.querySelector('.win-actions');
      if (actions) actions.style.display = 'none';

      // Wait for webfonts to be ready — html2canvas snapshots synchronously
      // and if Fredoka/Inter haven't finished loading, the capture shows
      // system fallback fonts instead of the fonts the user actually sees.
      const fontsReady = (document.fonts && document.fonts.ready)
        ? document.fonts.ready
        : Promise.resolve();

      fontsReady.then(() => html2canvas(overlayCard, {
        backgroundColor: '#0b1220',
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: (clonedDoc) => prepareWinCardClone(clonedDoc),
      })).then((canvas) => {
        if (actions) actions.style.display = '';
        canvas.toBlob((blob) => {
          if (!blob) {
            // Fallback: share text only
            shareTextOnly(text);
            return;
          }
          const file = new File([blob], 'mountain-goats-result.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
              title: 'Mountain Goats Result',
              text: text,
              files: [file],
            }).catch(() => shareTextOnly(text));
          } else if (navigator.share) {
            // Can share text but not files — share text and still save PNG
            shareTextOnly(text);
            downloadImage(canvas);
          } else {
            // No share API (desktop) — download the restored PNG
            downloadImage(canvas);
          }
        }, 'image/png');
      }).catch(() => {
        if (actions) actions.style.display = '';
        shareTextOnly(text);
      });
    } else {
      shareTextOnly(text);
    }
  }

  function shareTextOnly(text) {
    if (navigator.share) {
      navigator.share({ title: 'Mountain Goats Result', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('Result copied! 📋'));
    } else {
      toast(text.split('\n')[0]);
    }
  }

  function downloadImage(canvas) {
    try {
      const link = document.createElement('a');
      link.download = 'mountain-goats-result.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('Image saved! 📸');
    } catch (e) { /* ignore */ }
  }

  function shareRoom() {
    if (!state) return;
    const inviteUrl = buildInviteUrl(state.code);
    const text = `Join my Mountain Goats game!\nRoom code: ${state.code}\n${inviteUrl}`;
    if (navigator.share) {
      navigator.share({ title: 'Mountain Goats', text, url: inviteUrl }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(inviteUrl).then(() => toast('Invite link copied!'));
    } else {
      toast('Room code: ' + state.code);
    }
  }
  let leftRoom = false; // flag to ignore state broadcasts after leaving
  let rejoinInFlight = false;
  /** Keep win overlay visible after host Play Again until Back to Lobby. */
  let scorecardHold = false;
  /** Dismissed scorecard while room still finished; show lobby when host resets. */
  let waitingForLobbyAfterDismiss = false;

  /**
   * Storage key for a dismissed end-game scorecard in a room.
   *
   * @param {string|null|undefined} code Room code.
   * @returns {string|null}
   */
  function scorecardDoneKey(code) {
    return code ? `mg_scorecard_done_${code}` : null;
  }

  /**
   * sessionStorage key for an explicit Back to Lobby / Play Again dismiss.
   *
   * @param {string|null|undefined} code Room code.
   * @returns {string|null}
   */
  function scorecardUserDismissKey(code) {
    return code ? `mg_scorecard_user_dismiss_${code}` : null;
  }

  /**
   * Returns true when the user already dismissed the scorecard for this room.
   *
   * @param {string|null|undefined} code Room code.
   * @returns {boolean}
   */
  function isScorecardDone(code) {
    const key = scorecardDoneKey(code);
    if (!key) return false;
    return !!(sessionStorage.getItem(key) || localStorage.getItem(key));
  }

  /**
   * Persist that the scorecard was dismissed for this room.
   * Uses sessionStorage (plan) and localStorage so tab-close survives reopen.
   *
   * @param {string|null|undefined} code Room code.
   * @returns {void}
   */
  function markScorecardDone(code) {
    const key = scorecardDoneKey(code);
    if (!key) return;
    sessionStorage.setItem(key, '1');
    localStorage.setItem(key, '1');
  }

  /**
   * Mark an intentional dismiss so a later refresh does not reopen the scorecard.
   *
   * @param {string|null|undefined} code Room code.
   * @returns {void}
   */
  function markScorecardUserDismiss(code) {
    const key = scorecardUserDismissKey(code);
    if (key) sessionStorage.setItem(key, '1');
    markScorecardDone(code);
  }

  /**
   * Clear dismissed scorecard flag (new finished match or new room).
   *
   * @param {string|null|undefined} code Room code.
   * @returns {void}
   */
  function clearScorecardDone(code) {
    const key = scorecardDoneKey(code);
    const dismissKey = scorecardUserDismissKey(code);
    if (key) {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    }
    if (dismissKey) sessionStorage.removeItem(dismissKey);
  }

  // Refresh while viewing scorecard: allow it to show once (pagehide also marks done).
  try {
    const navEntry = performance.getEntriesByType('navigation')[0];
    const reloadCode = localStorage.getItem('mg_code');
    if (navEntry && navEntry.type === 'reload' && reloadCode) {
      const userDismiss = scorecardUserDismissKey(reloadCode);
      if (!userDismiss || !sessionStorage.getItem(userDismiss)) {
        const doneKey = scorecardDoneKey(reloadCode);
        if (doneKey) {
          sessionStorage.removeItem(doneKey);
          localStorage.removeItem(doneKey);
        }
      }
    }
  } catch (err) {
    /* ignore */
  }

  /**
   * Leave the scorecard into the lobby without leaving the room.
   *
   * @returns {void}
   */
  function dismissScorecardToLobby() {
    const code = state && state.code;
    if (code) markScorecardUserDismiss(code);
    scorecardHold = false;
    hideWinOverlay();
    if (!state) {
      waitingForLobbyAfterDismiss = false;
      show('home');
      return;
    }
    if (!state.started) {
      waitingForLobbyAfterDismiss = false;
      show('lobby');
      renderLobby();
      return;
    }
    if (state.finished) {
      // Host opens the lobby for everyone; others wait until that happens.
      if (state.hostId === myId) {
        waitingForLobbyAfterDismiss = false;
        socket.emit('playAgain');
        return;
      }
      waitingForLobbyAfterDismiss = true;
      toast('Waiting for the host to open the lobby…');
      updateFinishedGameChrome();
      return;
    }
    waitingForLobbyAfterDismiss = false;
    show('game');
    renderGame();
  }

  /**
   * Dismiss the scorecard and show the finished board without leaving the room.
   *
   * @returns {void}
   */
  function viewBoardFromScorecard() {
    const code = state && state.code;
    if (code) markScorecardUserDismiss(code);
    scorecardHold = false;
    waitingForLobbyAfterDismiss = false;
    hideWinOverlay();
    if (!state) {
      show('home');
      return;
    }
    show('game');
    renderGame();
  }

  /**
   * Toggle Results / Back to Lobby / dice controls for a finished match.
   *
   * @returns {void}
   */
  function updateFinishedGameChrome() {
    const finished = !!(state && state.started && state.finished);
    const resultsBtn = $('btn-results');
    const lobbyBtn = $('btn-game-lobby');
    const playControls = $('play-controls');
    const finishedControls = $('finished-controls');
    const diceArea = $('dice-area');
    const selSum = $('sel-sum');

    if (playControls) playControls.hidden = finished;
    if (diceArea) diceArea.hidden = finished;
    if (selSum) selSum.hidden = finished;
    const turnTimerEl = $('turn-timer');
    if (finished && turnTimerEl) {
      clearLocalTurnTimer();
      turnTimerEl.hidden = true;
    }

    if (finishedControls) finishedControls.hidden = !finished;
    if (resultsBtn) resultsBtn.hidden = !finished;
    if (lobbyBtn) lobbyBtn.hidden = !finished;
  }

  /**
   * From the finished board: go to lobby (host resets the room for everyone).
   *
   * @returns {void}
   */
  function backToLobbyFromBoard() {
    dismissScorecardToLobby();
  }

  /**
   * Mark scorecard dismissed for this room so close/reopen skips it.
   *
   * @returns {void}
   */
  function markScorecardDoneOnUnload() {
    if (!state || !state.finished || !state.code) return;
    const overlay = $('win-overlay');
    const overlayShown = overlay && overlay.classList.contains('show');
    if (scorecardHold || overlayShown) {
      markScorecardDone(state.code);
    }
  }

  window.addEventListener('pagehide', () => {
    markScorecardDoneOnUnload();
    disconnectSocketOnUnload();
  });
  window.addEventListener('beforeunload', () => {
    markScorecardDoneOnUnload();
    disconnectSocketOnUnload();
  });

  /**
   * Re-sync lobby presence so signed-in wins load after auth connects.
   *
   * @returns {Promise<void>}
   */
  async function refreshLobbyPresence() {
    if (!socket.connected || leftRoom || lobbyWinsRefreshInFlight) return;
    if (!state || state.started) return;
    if (!isSignedIn()) return;

    const name = getPlayName();
    if (!name) return;

    const mePlayer = state.players.find((p) => p.id === myId);
    if (mePlayer && typeof mePlayer.totalWins === 'number') return;

    const attempts = lobbyWinsRefreshAttempts.get(state.code) || 0;
    if (attempts >= 3) return;

    lobbyWinsRefreshInFlight = true;
    lobbyWinsRefreshAttempts.set(state.code, attempts + 1);
    try {
      const payload = await buildRoomPayload({ name, code: state.code });
      await new Promise((resolve) => {
        socket.emit('joinRoom', payload, (res) => {
          if (res && res.ok) myId = res.youId;
          resolve();
        });
      });
    } finally {
      lobbyWinsRefreshInFlight = false;
    }
  }

  /**
   * Rejoin a saved room when socket is ready and a play name is available.
   * Also re-binds after socket id changes (auth reconnect) even if state exists.
   */
  async function tryRejoin() {
    if (!socket.connected || rejoinInFlight || leftRoom) return;
    // Already bound to this socket — nothing to do.
    if (state && myId === socket.id) return;

    const code = localStorage.getItem('mg_code');
    if (!code) {
      if (screens.loading.classList.contains('active')) show('home');
      return;
    }

    // Prefer live input, then guest storage, then cached signed-in GOAT name.
    const storedName = localStorage.getItem('mg_name') || localStorage.getItem('mg_gaming_name') || '';
    const name = getPlayName() || storedName;
    if (!name) {
      // Auth/name not ready yet — keep loading and retry on mg-auth-changed / connect.
      if (!screens.loading.classList.contains('active')) show('loading');
      return;
    }

    if (!screens.loading.classList.contains('active') && !(state && state.started)) {
      show('loading');
    }

    rejoinInFlight = true;
    const dismissedFinished = isScorecardDone(code) && state && state.finished;
    if (!dismissedFinished) leftRoom = false;
    try {
      const payload = await buildRoomPayload({ name, code });
      socket.emit('joinRoom', payload, (res) => {
        rejoinInFlight = false;
        if (res && res.ok) {
          myId = res.youId;
          // Intentionally dismissed or left: do not restore scorecard via rejoin keys.
          if (leftRoom || isScorecardDone(code)) {
            return;
          }
          storeRejoinKeys(name, code);
          // Rejoin broadcast may not re-trigger showWin (already finished).
          if (state && state.finished) {
            const overlay = $('win-overlay');
            if (overlay && !overlay.classList.contains('show')) showWin();
          }
        } else {
          localStorage.removeItem('mg_code');
          localStorage.removeItem('mg_name');
          // Keep the scorecard if we already have a finished game locally (and not dismissed).
          if (state && state.finished && !isScorecardDone(code)) {
            toast((res && res.error) ? res.error : 'Room closed. You can still view the result.');
            const overlay = $('win-overlay');
            if (overlay && !overlay.classList.contains('show')) showWin();
          } else if (!(state && state.finished && scorecardHold)) {
            state = null;
            scorecardHold = false;
            waitingForLobbyAfterDismiss = false;
            hideWinOverlay();
            show('home');
          }
        }
      });
    } catch (err) {
      rejoinInFlight = false;
      console.error('[main] tryRejoin failed:', err);
    }
  }

  function leaveToHome() {
    leftRoom = true;
    scorecardHold = false;
    waitingForLobbyAfterDismiss = false;
    if (state && state.code) clearScorecardDone(state.code);
    socket.emit('leaveRoom');
    state = null;
    lobbyWinsRefreshAttempts.clear();
    localStorage.removeItem('mg_code');
    localStorage.removeItem('mg_name');
    hideWinOverlay();
    show('home');
  }

  // ===================== GAME CONTROLS =====================
  $('btn-roll').addEventListener('click', () => {
    pendingSelfDiceRollAt = Date.now();
    if (window.MGSounds) {
      window.MGSounds.unlock();
      window.MGSounds.play({ type: 'dice_roll', self: true });
    }
    if (window.MGHaptics) window.MGHaptics.trigger({ type: 'dice_roll', self: true });
    socket.emit('rollDice');
    $('dice-area').classList.add('rolling');
    setTimeout(() => $('dice-area').classList.remove('rolling'), 720);
  });
  $('btn-endturn').addEventListener('click', () => {
    if (window.MGSounds) {
      window.MGSounds.unlock();
      window.MGSounds.play({ type: 'ui_tap', self: true });
    }
    if (window.MGHaptics) window.MGHaptics.trigger({ type: 'ui_tap', self: true });
    if (isMyTurn() && state.rolled && anyGroupPossible()) {
      // Show confirmation popup if there are still valid groups
      $('endturn-overlay').classList.add('show');
    } else {
      socket.emit('endTurn');
    }
  });
  $('btn-endturn-confirm').addEventListener('click', () => {
    $('endturn-overlay').classList.remove('show');
    socket.emit('endTurn');
  });
  $('btn-endturn-cancel').addEventListener('click', () => {
    $('endturn-overlay').classList.remove('show');
  });
  $('btn-game-lobby').addEventListener('click', () => {
    backToLobbyFromBoard();
  });
  $('btn-view-board').addEventListener('click', () => {
    viewBoardFromScorecard();
  });
  $('btn-results').addEventListener('click', () => {
    showWin({ force: true });
  });
  $('btn-home').addEventListener('click', () => {
    dismissScorecardToLobby();
  });
  $('btn-win-share').addEventListener('click', shareWinResult);

  // Handle being kicked by the host
  socket.on('kicked', (data) => {
    leftRoom = true;
    scorecardHold = false;
    waitingForLobbyAfterDismiss = false;
    state = null;
    localStorage.removeItem('mg_code');
    localStorage.removeItem('mg_name');
    hideWinOverlay();
    show('home');
    const hostName = (data && data.hostName) ? data.hostName : 'The host';
    toast(`${hostName} kicked you from the room.`);
  });

  // ===================== SOCKET =====================
  let connectErrors = 0;

  socket.on('connect', () => {
    connectErrors = 0;
    socketConnectionHasAuth = Boolean(socket.auth.token);
    if (isSignedIn()) scheduleSocketAuthReconnect();
    tryRejoin();
  });

  // Track consecutive connection failures — only give up after several.
  socket.on('connect_error', () => {
    connectErrors++;
    if (screens.loading.classList.contains('active') && connectErrors >= 5) {
      localStorage.removeItem('mg_code');
      localStorage.removeItem('mg_name');
      show('home');
    }
  });

  // Online player count
  socket.on('onlineCount', (count) => {
    const el = $('online-count');
    if (el) el.textContent = `\u{1F7E2} ${count} player${count !== 1 ? 's' : ''} online`;
  });

  socket.on('match-stats', (stats) => {
    if (!stats || typeof stats.matchesWon !== 'number') return;
    pendingMatchStats = stats;
    if (state && state.finished) {
      updateWinStatsBanner(didCurrentPlayerWin());
    }
  });

  socket.on('state', (s) => {
    if (leftRoom) return; // ignore stale broadcasts after leaving
    const wasFinished = !!(state && state.finished);
    const prevCode = state && state.code;
    if (state && s && typeof deriveFeedbackEvents === 'function') {
      const events = deriveFeedbackEvents(state, s, myId).filter((event) => {
        if (event.type === 'dice_roll' && event.self && Date.now() - pendingSelfDiceRollAt < 900) {
          return false;
        }
        return true;
      });
      const ctx = { didWin: s.finished ? didPlayerWinForState(s, myId) : false, myId };
      events.forEach((event) => {
        if (window.MGHaptics) window.MGHaptics.trigger(event, ctx);
        if (window.MGSounds) window.MGSounds.play(event, ctx);
      });
    }
    state = s;

    if (prevCode && s && prevCode !== s.code) {
      scorecardHold = false;
      waitingForLobbyAfterDismiss = false;
    }

    // New finished match: allow scorecard again for this room.
    if (s && s.finished && !wasFinished) {
      clearScorecardDone(s.code);
    }

    // Host Play Again: keep overlay if still holding; otherwise close.
    if (s && !s.finished && !scorecardHold) {
      hideWinOverlay();
    }

    if (waitingForLobbyAfterDismiss && s && !s.started) {
      waitingForLobbyAfterDismiss = false;
      scorecardHold = false;
      hideWinOverlay();
      show('lobby');
      renderLobby();
    } else {
      render();
    }

    const done = !!(s && isScorecardDone(s.code));
    if (s && s.finished && !done) {
      if (!wasFinished) {
        showWin();
      } else if (scorecardHold) {
        const overlay = $('win-overlay');
        if (overlay && !overlay.classList.contains('show')) showWin();
      }
    }

    if (s && !s.started && isSignedIn()) {
      refreshLobbyPresence();
    }
  });

  // ===================== HELPERS =====================
  function me() {
    return state ? state.players.find((p) => p.id === myId) : null;
  }
  function isMyTurn() {
    return state && state.currentPlayerId === myId && state.started && !state.finished;
  }

  function selectedSum() {
    let s = 0;
    selected.forEach((i) => (s += state.dice[i]));
    return s;
  }
  function targetMountain() {
    if (!selected.size) return -1;
    const sum = selectedSum();
    return state.mountains.findIndex((m) => m.value === sum);
  }
  // can any subset of unused dice reach a value 5-10?
  function anyGroupPossible() {
    if (!state.dice) return false;
    // If there are still adjustable dice (extra 1s that can be re-faced),
    // don't auto-end — the player hasn't had a chance to change them yet.
    const noneUsed = !state.diceUsed.some((u) => u);
    if (noneUsed && state.adjustable && state.adjustable.length > 0) return true;
    const idx = state.dice.map((_, i) => i).filter((i) => !state.diceUsed[i]);
    const n = idx.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let sum = 0;
      for (let b = 0; b < n; b++) if (mask & (1 << b)) sum += state.dice[idx[b]];
      if (sum >= 5 && sum <= 10) return true;
    }
    return false;
  }

  // ===================== RENDER =====================

  /**
   * Returns true when this client may move the given player between teams.
   *
   * @param {string} playerId Player socket id.
   * @param {boolean} amHost Whether local user is host.
   * @returns {boolean}
   */
  function canMoveTeamPlayer(playerId, amHost) {
    if (!state || !GameModes.modeUsesTeams(currentMode()) || !state.teams || state.teams.length < 1) return false;
    return amHost || playerId === myId;
  }

  /**
   * Emit a team move for host (any player) or self.
   *
   * @param {string} playerId Player to move.
   * @param {number} toTeamId Destination team id.
   * @returns {void}
   */
  function emitTeamMove(playerId, toTeamId) {
    if (!state || !GameModes.modeUsesTeams(currentMode()) || !state.teams) return;
    const amHost = state.hostId === myId;
    // Non-hosts may only move themselves.
    const moveId = amHost ? playerId : myId;
    if (!canMoveTeamPlayer(moveId, amHost)) return;
    const toId = Number(toTeamId);
    if (!Number.isFinite(toId)) return;
    const current = state.teams.find((t) => t.members.includes(moveId));
    if (current && current.id === toId) return;
    if (!state.teams.some((t) => t.id === toId)) return;

    if (amHost) {
      socket.emit('swapTeam', { playerId: moveId, toTeamId: toId });
    } else {
      socket.emit('selfSwapTeam', { toTeamId: toId });
    }
  }

  /**
   * Replace a player row with inline team choices.
   *
   * @param {HTMLElement} anchorRow Player row to convert.
   * @param {string} playerId Player to move.
   * @param {number|null} fromTeamId Current team id, or null if unassigned.
   * @returns {void}
   */
  function openTeamPicker(anchorRow, playerId, fromTeamId) {
    if (!state || !state.teams || !state.teams.length) return;
    closeColorPicker();
    closeTeamPicker();

    const destinations = state.teams.filter((t) => t.id !== fromTeamId);
    if (!destinations.length) return;
    const player = state.players.find((pl) => pl.id === playerId);
    const amHost = state.hostId === myId;

    teamPickerRestore = {
      row: anchorRow,
      html: anchorRow.innerHTML,
      title: anchorRow.title,
      amHost,
    };

    anchorRow.classList.add('team-picker-source', 'team-move-bar');
    anchorRow.title = '';
    anchorRow.innerHTML = '';

    const label = document.createElement('span');
    label.className = 'team-move-label';
    label.textContent = player ? `Move ${player.name} to` : 'Move to';
    anchorRow.appendChild(label);

    const choices = document.createElement('div');
    choices.className = 'team-move-choices';
    destinations.forEach((team) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'team-move-chip';
      chip.style.setProperty('--tc', team.color);
      chip.textContent = team.name.charAt(0).toUpperCase();
      chip.title = `Team ${team.name}`;
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        emitTeamMove(playerId, team.id);
        closeTeamPicker();
      });
      choices.appendChild(chip);
    });
    anchorRow.appendChild(choices);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'team-move-close';
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Cancel');
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeTeamPicker();
    });
    anchorRow.appendChild(closeBtn);

    teamPickerEl = anchorRow;

    setTimeout(() => {
      teamPickerOutsideHandler = (e) => {
        if (e.target.closest('.team-member.team-move-bar')) return;
        closeTeamPicker();
      };
      document.addEventListener('click', teamPickerOutsideHandler);
      teamPickerKeyHandler = (e) => {
        if (e.key === 'Escape') closeTeamPicker();
      };
      document.addEventListener('keydown', teamPickerKeyHandler);
    }, 0);
  }

  /**
   * Build one lobby player row inside a team band.
   *
   * @param {object} p Player.
   * @param {number|null} fromTeamId Current team id or null if unassigned.
   * @param {boolean} amHost Whether local user is host.
   * @param {string} [extraBadge] Optional badge HTML.
   * @returns {HTMLLIElement}
   */
  function buildTeamMemberRow(p, fromTeamId, amHost, extraBadge) {
    const li = document.createElement('li');
    li.className = 'team-member';
    if (p.id === myId) li.classList.add('lobby-you');
    li.dataset.playerId = p.id;
    if (fromTeamId != null) li.dataset.fromTeamId = String(fromTeamId);
    li.innerHTML = lobbyPlayerRowHtml(p, lobbyPlayerBadgesHtml(p, extraBadge || ''));
    appendTeamSwitchBtn(li, p, amHost);
    appendKickBtn(li, p, amHost);
    attachLobbySwatch(li, p);

    const movable = canMoveTeamPlayer(p.id, amHost) && state.teams && state.teams.length > 0;
    if (movable) {
      li.classList.add('team-movable');
      li.title = 'Change team';
    }
    return li;
  }

  /**
   * Build a colored team band with header and member rows.
   *
   * @param {object} team Team public state.
   * @param {boolean} amHost Whether local user is host.
   * @returns {HTMLLIElement}
   */
  function buildTeamBand(team, amHost) {
    const band = document.createElement('li');
    band.className = 'team-band';
    band.dataset.teamId = String(team.id);
    band.style.setProperty('--team-color', team.color);
    band.style.borderColor = team.color;
    band.style.background = `${team.color}22`;

    const header = document.createElement('div');
    header.className = 'team-band-header';
    header.innerHTML = `<span class="team-dot" style="background:${team.color}"></span>
      <span class="team-label">Team ${escapeHtml(team.name)}</span>
      <span class="team-count">${team.members.length} player${team.members.length !== 1 ? 's' : ''}</span>`;
    band.appendChild(header);

    const members = document.createElement('ul');
    members.className = 'team-band-members';
    team.members.forEach((pid) => {
      const p = state.players.find((pl) => pl.id === pid);
      if (!p) return;
      members.appendChild(buildTeamMemberRow(p, team.id, amHost));
    });
    band.appendChild(members);
    return band;
  }

  /**
   * Build the unassigned players band (source for assigning into teams).
   *
   * @param {object[]} unassigned Players not on any team.
   * @param {boolean} amHost Whether local user is host.
   * @returns {HTMLLIElement}
   */
  function buildUnassignedBand(unassigned, amHost) {
    const band = document.createElement('li');
    band.className = 'team-band team-band-unassigned';
    band.dataset.teamId = '';
    band.style.setProperty('--team-color', '#666666');

    const header = document.createElement('div');
    header.className = 'team-band-header';
    header.innerHTML = `<span class="team-dot" style="background:#666"></span>
      <span class="team-label">Unassigned</span>
      <span class="team-count">${unassigned.length} player${unassigned.length !== 1 ? 's' : ''}</span>`;
    band.appendChild(header);

    const members = document.createElement('ul');
    members.className = 'team-band-members';
    unassigned.forEach((p) => {
      members.appendChild(buildTeamMemberRow(p, null, amHost, '<span class="badge">UNASSIGNED</span>'));
    });
    band.appendChild(members);
    return band;
  }

  /**
   * Wire tap-to-change-team on movable lobby rows.
   *
   * @param {HTMLElement} listRoot Lobby players list element.
   * @param {boolean} amHost Whether local user is host.
   * @returns {void}
   */
  function wireTeamBandInteractions(listRoot, amHost) {
    listRoot.querySelectorAll('.team-member.team-movable').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest && (
          e.target.closest('.kick-btn')
          || e.target.closest('.swatch-clickable')
          || e.target.closest('.swatch')
          || e.target.closest('button')
        )) return;

        const playerId = row.dataset.playerId;
        if (!playerId || !canMoveTeamPlayer(playerId, amHost)) return;

        e.preventDefault();
        e.stopPropagation();

        if (teamPickerEl && teamPickerEl.dataset.playerId === playerId) {
          closeTeamPicker();
          return;
        }

        const fromTeamId = row.dataset.fromTeamId != null && row.dataset.fromTeamId !== ''
          ? Number(row.dataset.fromTeamId)
          : null;
        openTeamPicker(row, playerId, fromTeamId);
      });
    });
  }

  function render() {
    if (!state) return;
    // Holding the scorecard: refresh lobby DOM behind the overlay, do not yank screens.
    if (scorecardHold) {
      if (!state.started) renderLobby();
      return;
    }
    if (!state.started) {
      show('lobby');
      renderLobby();
    } else {
      show('game');
      renderGame();
    }
  }

  function renderLobby() {
    closeColorPicker();
    closeTeamPicker();
    $('lobby-code').textContent = state.code;
    const amHost = state.hostId === myId;

    // Room settings (host only)
    const settingsCard = $('room-settings');
    if (settingsCard) {
      settingsCard.style.display = amHost ? 'block' : 'none';
      if (amHost) {
        const isPublic = state.isPublic || false;
        $('btn-private').classList.toggle('active', !isPublic);
        $('btn-public').classList.toggle('active', isPublic);
        $('maxp-display').textContent = state.maxPlayers || MAX_PLAYERS;
        $('btn-maxp-down').disabled = (state.maxPlayers || MAX_PLAYERS) <= Math.max(2, state.players.length);
        $('btn-maxp-up').disabled = (state.maxPlayers || MAX_PLAYERS) >= MAX_PLAYERS;
        const turnIdx = turnTimeOptionIndex();
        $('turn-timer-display').textContent = formatTurnTimeSec(TURN_TIME_OPTIONS[turnIdx]);
        $('btn-turn-timer-down').disabled = turnIdx <= 0;
        $('btn-turn-timer-up').disabled = turnIdx >= TURN_TIME_OPTIONS.length - 1;
      }
    }

    const ul = $('lobby-players');
    ul.innerHTML = '';
    currentMode().renderLobbyPlayers(ul, {
      state,
      myId,
      amHost,
      lobbyPlayerRowHtml,
      lobbyPlayerBadgesHtml,
      appendKickBtn,
      attachLobbySwatch,
      buildTeamBand,
      buildUnassignedBand,
      wireTeamBandInteractions,
    });

    currentMode().updateLobbySettings({ $, state, amHost });

    const startBtn = $('btn-start');
    const addBtn = $('btn-addbot');
    startBtn.style.display = amHost ? 'block' : 'none';
    addBtn.style.display = amHost ? 'block' : 'none';
    addBtn.disabled = state.players.length >= (state.maxPlayers || MAX_PLAYERS);

    const teamsUnequal = currentMode().teamsUnequal(state);

    startBtn.disabled = state.players.length < 2 || teamsUnequal;
    if (amHost) {
      if (state.players.length < 2) {
        $('lobby-hint').textContent = 'Add a bot or wait for a friend to join.';
      } else if (teamsUnequal) {
        $('lobby-hint').textContent = 'Teams must be equal to start!';
        $('lobby-hint').style.color = 'var(--danger)';
      } else {
        $('lobby-hint').textContent = currentMode().lobbyReadyHint(state, amHost);
        $('lobby-hint').style.color = '';
      }
    } else {
      $('lobby-hint').textContent = 'Waiting for the host to start…';
      $('lobby-hint').style.color = '';
    }
  }

  function clearLocalTurnTimer() {
    if (turnTimerLocalInterval) {
      clearInterval(turnTimerLocalInterval);
      turnTimerLocalInterval = null;
    }
  }

  /**
   * Sync the dice-row countdown to server turnDeadline.
   * @returns {void}
   */
  function syncTurnTimerDisplay() {
    const el = $('turn-timer');
    if (!el) return;
    clearLocalTurnTimer();

    const active = !!(
      state
      && state.started
      && !state.finished
      && (state.turnTimeSec || 0) > 0
      && state.turnDeadline
    );

    if (!active) {
      el.hidden = true;
      el.textContent = '—';
      el.classList.remove('warn');
      return;
    }

    el.hidden = false;

    /**
     * Paint remaining whole seconds from the server deadline.
     * @returns {void}
     */
    function paint() {
      const remaining = Math.max(0, Math.ceil((state.turnDeadline - Date.now()) / 1000));
      el.textContent = String(remaining);
      el.classList.toggle('warn', remaining <= 5);
    }

    paint();
    turnTimerLocalInterval = setInterval(paint, 250);
  }

  function renderGame() {
    try { $('game-code').textContent = state.code; } catch(e) {}
    syncSelection();
    try { renderTurnBanner(); } catch(e) { console.error('renderTurnBanner', e); }
    try { renderStats(); } catch(e) { console.error('renderStats', e); }
    try { renderBonusRow(); } catch(e) { console.error('renderBonusRow', e); }
    try { renderBoard(); } catch(e) { console.error('renderBoard', e); }
    try { renderDice(); } catch(e) { console.error('renderDice', e); }
    try { syncTurnTimerDisplay(); } catch(e) { console.error('syncTurnTimerDisplay', e); }
    try { renderControls(); } catch(e) { console.error('renderControls', e); }
    try { updateFinishedGameChrome(); } catch(e) { console.error('updateFinishedGameChrome', e); }
  }

  function syncSelection() {
    const sig = state.currentPlayerId + '|' + state.rolled;
    if (sig !== selSig) {
      selected.clear();
      selSig = sig;
    }
    [...selected].forEach((i) => {
      if (!state.dice || i >= state.dice.length || state.diceUsed[i]) selected.delete(i);
    });
    if (!isMyTurn() || !state.rolled) selected.clear();
  }

  function renderTurnBanner() {
    const banner = $('turn-banner');
    if (state && state.finished) {
      banner.textContent = 'Game over';
      banner.classList.remove('my-turn');
      banner.classList.remove('final');
      return;
    }
    const cur = state.players[state.currentIndex];
    if (!cur) { banner.textContent = '—'; return; }
    const finalTag = state.lastRound ? '🔔 Final · ' : '';
    if (isMyTurn()) {
      banner.textContent = finalTag + '🎯 Your turn!';
      banner.classList.add('my-turn');
      banner.classList.remove('final');
    } else if (!cur.connected && !cur.isBot) {
      banner.textContent = `${finalTag}🤖 Auto-playing for ${cur.name}…`;
      banner.classList.remove('my-turn');
      banner.classList.toggle('final', !!state.lastRound);
    } else {
      banner.textContent = `${finalTag}${cur.name}${cur.isBot ? ' 🤖' : ''}'s turn`;
      banner.classList.remove('my-turn');
      banner.classList.toggle('final', !!state.lastRound);
    }
  }

  function renderStats() {
    const strip = $('stats-strip');
    strip.innerHTML = '';
    currentMode().renderStats(strip, { state, escapeHtml, playerCoinHtml });
  }

  function renderBonusRow() {
    const row = $('bonus-row');
    if (!row) return;
    const all = [15, 12, 9, 6];
    const remaining = new Set(state.bonusTokens || []);
    row.innerHTML = '<span class="bonus-label">Bonus</span>' + all
      .map((v) => {
        if (remaining.has(v)) {
          return `<span class="bonus-tok">✨${v}</span>`;
        }
        const claimer = state.players.find((p) => (p.bonus || []).includes(v));
        if (claimer && claimer.color) {
          return `<span class="bonus-tok claimed" style="--c:${claimer.color}" title="${escapeHtml(claimer.name)}">✨${v}</span>`;
        }
        return `<span class="bonus-tok gone">✨${v}</span>`;
      })
      .join('');
  }

  /**
   * Column paint color: holder coin (or team color) when a goat is on the summit.
   *
   * @param {object} m Mountain public state.
   * @param {number} mi Mountain index.
   * @returns {string} CSS color.
   */
  function mountainColumnColor(m, mi) {
    const holders = state.players.filter((pl) => (pl.pos || [])[mi] >= m.height);
    if (!holders.length) return m.color;
    if (GameModes.modeUsesTeams(currentMode()) && state.teams) {
      const team = state.teams.find((t) => t.members.includes(holders[0].id));
      if (team && team.color) return team.color;
    }
    return holders[0].color || m.color;
  }

  function renderBoard() {
    const board = $('board');
    board.innerHTML = '';
    const tMi = targetMountain();

    state.mountains.forEach((m, mi) => {
      const col = document.createElement('div');
      col.className = 'mcol';
      const isTarget = isMyTurn() && state.rolled && mi === tMi;
      if (isTarget) col.classList.add('target');
      if (m.chips <= 0) col.classList.add('is-empty');
      const paint = mountainColumnColor(m, mi);
      const trackPaint = m.chips > 0 ? paint : m.color;

      // tooltip-ish header: tokens remaining (number keeps summit coin color)
      const head = document.createElement('div');
      head.className = 'mhead';
      head.innerHTML = `<span class="mtok${m.chips > 0 ? '' : ' empty'}" style="--c:${paint}">${m.value}</span>
        <span class="mleft">${m.chips > 0 ? '×' + m.chips : 'EMPTY'}</span>`;
      col.appendChild(head);

      // climbing track: top space (pos=height) down to bottom (pos=1)
      const track = document.createElement('div');
      track.className = 'track';
      for (let p = m.height; p >= 1; p--) {
        const wrap = document.createElement('div');
        wrap.className = 'cell-wrap';
        const cell = document.createElement('div');
        cell.className = 'cell' + (p === m.height ? ' top' : '');
        cell.style.setProperty('--c', trackPaint);
        cell.innerHTML = `<span class="cnum">${m.value}</span>`;
        const here = state.players.filter((pl) => (pl.pos || [])[mi] === p);
        if (here.length) cell.appendChild(goatCluster(here));
        wrap.appendChild(cell);
        track.appendChild(wrap);
      }
      col.appendChild(track);

      // foot (pos 0)
      const foot = document.createElement('div');
      foot.className = 'foot';
      const footGoats = state.players.filter((pl) => (pl.pos || [])[mi] === 0);
      if (footGoats.length) foot.appendChild(goatCluster(footGoats));
      col.appendChild(foot);

      if (isTarget) {
        col.addEventListener('click', () => {
          socket.emit('moveGroup', { indices: [...selected], mountainIndex: mi });
          selected.clear();
        });
      }
      board.appendChild(col);
    });
  }

  function goatCluster(players) {
    const wrap = document.createElement('div');
    wrap.className = 'goats';
    const turnId = state && state.started && !state.finished ? state.currentPlayerId : null;
    players.forEach((p) => {
      const g = document.createElement('div');
      g.className = 'goat'
        + (p.id === myId ? ' me' : '')
        + (turnId && p.id === turnId ? ' turn' : '');
      g.style.background = p.color;
      g.textContent = p.name.charAt(0).toUpperCase();
      g.title = p.name;
      wrap.appendChild(g);
    });
    return wrap;
  }

  function renderDice() {
    const area = $('dice-area');
    if (!area) return;
    if (state && state.finished) {
      area.innerHTML = '';
      return;
    }
    area.innerHTML = '';
    const mine = isMyTurn();
    if (!state.rolled || !state.dice) {
      for (let i = 0; i < (state.numDice || 4); i++) {
        const d = document.createElement('div');
        d.className = 'die';
        d.textContent = '🎲';
        area.appendChild(d);
      }
      return;
    }
    const noneUsed = !state.diceUsed.some((u) => u);
    if (
      refacePickerIndex != null
      && !(noneUsed && state.adjustable && state.adjustable.includes(refacePickerIndex))
    ) {
      refacePickerIndex = null;
    }
    state.dice.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = 'die'
        + (state.diceUsed[i] ? ' used' : '')
        + (selected.has(i) ? ' sel' : '');
      d.textContent = v;
      if (mine && !state.diceUsed[i]) {
        d.addEventListener('click', () => {
          if (refacePickerIndex != null) {
            refacePickerIndex = null;
            renderGame();
            return;
          }
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          renderGame();
        });
      }
      // Extra-1 re-face: active player can open picker; others still see which dice are refaceable.
      if (noneUsed && state.adjustable && state.adjustable.includes(i)) {
        if (mine) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'reface';
          btn.textContent = '↻';
          btn.title = 'Change this die to any face';
          btn.setAttribute('aria-label', 'Choose a new face for this die');
          btn.setAttribute('aria-expanded', refacePickerIndex === i ? 'true' : 'false');
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            refacePickerIndex = refacePickerIndex === i ? null : i;
            renderGame();
          });
          d.appendChild(btn);
        } else {
          const badge = document.createElement('span');
          badge.className = 'reface reface--observe';
          badge.textContent = '↻';
          badge.title = 'This die can still be re-faced';
          badge.setAttribute('aria-label', 'This die can still be re-faced');
          badge.setAttribute('role', 'img');
          d.appendChild(badge);
        }
      }
      area.appendChild(d);
    });
    if (refacePickerIndex != null) {
      const index = refacePickerIndex;
      const current = state.dice[index];
      const picker = document.createElement('div');
      picker.className = 'reface-picker';
      picker.setAttribute('role', 'listbox');
      picker.setAttribute('aria-label', 'Choose die face');
      picker.addEventListener('click', (e) => e.stopPropagation());
      for (let face = 1; face <= 6; face++) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'reface-face' + (face === current ? ' is-current' : '');
        opt.textContent = String(face);
        opt.setAttribute('role', 'option');
        opt.setAttribute('aria-label', `Face ${face}`);
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          refacePickerIndex = null;
          if (window.MGSounds) window.MGSounds.play({ type: 'dice_adjust', self: true });
          socket.emit('adjustDie', { index, value: face });
        });
        picker.appendChild(opt);
      }
      area.appendChild(picker);
    }
  }

  function renderControls() {
    const mine = isMyTurn();
    const finished = !!(state && state.finished);
    $('btn-roll').disabled = finished || !mine || state.rolled;
    $('btn-endturn').disabled = finished || !mine || !state.rolled;

    const sumEl = $('sel-sum');
    const sum = selectedSum();
    const tMi = targetMountain();
    if (!finished && mine && state.rolled && selected.size) {
      sumEl.textContent = tMi >= 0 ? `Group = ${sum} → tap Mountain ${sum}` : `Group = ${sum} (no mountain)`;
      sumEl.classList.toggle('ok', tMi >= 0);
    } else {
      sumEl.textContent = '';
      sumEl.classList.remove('ok');
    }

    const hint = $('game-hint');
    if (state.finished) {
      hint.textContent = 'Game over. Open Results or go Back to Lobby.';
      hint.classList.remove('auto-end');
    } else if (!mine) {
      const cur = state.players[state.currentIndex];
      hint.textContent = cur ? `Waiting for ${cur.name}…` : '';
    } else if (!state.rolled) hint.textContent = 'Tap "Roll Dice" to roll 4 dice.';
    else if (!anyGroupPossible()) {
      // Auto-end turn after 2 seconds when no valid groups remain
      if (!autoEndTimer) {
        hint.textContent = 'No groups make 5–10 — ending turn in 2s…';
        hint.classList.add('auto-end');
        autoEndTimer = setTimeout(() => {
          autoEndTimer = null;
          hint.classList.remove('auto-end');
          if (isMyTurn() && state.rolled && !anyGroupPossible()) {
            socket.emit('endTurn');
          }
        }, 2000);
      }
    } else {
      // Valid groups exist — cancel any pending auto-end
      if (autoEndTimer) {
        clearTimeout(autoEndTimer);
        autoEndTimer = null;
        hint.classList.remove('auto-end');
      }
      if (!selected.size) hint.textContent = 'Tap dice to group them (sum 5–10), then tap that mountain.';
      else hint.textContent = tMi >= 0 ? 'Tap the glowing mountain to climb 🐐' : 'This group is not 5–10. Adjust your selection.';
    }
  }

  /**
   * Right-side score for the win overlay.
   * With bonus: "15 ✨ · 53 ⭐"; otherwise "53 ⭐".
   *
   * @param {number} score Total score.
   * @param {number} [bonusPoints] Bonus token points claimed (omit or 0 to hide).
   * @returns {string} HTML
   */
  function winScoreRightHtml(score, bonusPoints) {
    const s = score || 0;
    const b = bonusPoints || 0;
    const scorePart = `<span class="sb-count-score" data-target="${s}">0</span> ⭐`;
    if (b > 0) {
      return `<span class="sb-right"><span class="sb-count-bonus" data-target="${b}">${b}</span> ✨ · ${scorePart}</span>`;
    }
    return `<span class="sb-right">${scorePart}</span>`;
  }

  function cancelWinCountUp() {
    winCountUpFrames.forEach((id) => cancelAnimationFrame(id));
    winCountUpFrames = [];
  }

  function winRowIndex(row) {
    const inline = row.getAttribute('style') || '';
    const m = inline.match(/--i:\s*(\d+)/);
    if (m) return parseInt(m[1], 10);
    return parseInt(getComputedStyle(row).getPropertyValue('--i'), 10) || 0;
  }

  function animateWinCount(el, target, duration, delay) {
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const startAt = performance.now() + delay;
    function tick(now) {
      if (now < startAt) {
        winCountUpFrames.push(requestAnimationFrame(tick));
        return;
      }
      const t = Math.min(1, (now - startAt) / duration);
      el.textContent = String(Math.round(target * easeOut(t)));
      if (t < 1) winCountUpFrames.push(requestAnimationFrame(tick));
      else el.textContent = String(target);
    }
    winCountUpFrames.push(requestAnimationFrame(tick));
  }

  function startWinScoreCountUp() {
    cancelWinCountUp();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const els = document.querySelectorAll('#win-overlay .sb-count-score');
    if (reduced) {
      els.forEach((el) => { el.textContent = el.dataset.target; });
      return;
    }
    const duration = 650;
    document.querySelectorAll('#win-overlay .score-row').forEach((row) => {
      const delay = 380 + winRowIndex(row) * 90;
      row.querySelectorAll('.sb-count-score').forEach((el) => {
        el.textContent = '0';
        animateWinCount(el, parseInt(el.dataset.target, 10) || 0, duration, delay);
      });
    });
  }

  function revealWinOverlay() {
    cancelWinCountUp();
    const overlay = $('win-overlay');
    overlay.classList.remove('show');
    void overlay.offsetWidth;
    overlay.classList.add('show');
    startWinScoreCountUp();
    startWinConfetti();
  }

  /**
   * Players sorted by score then tops (same order as the scoreboard).
   *
   * @returns {object[]}
   */
  function sortedPlayersByScore() {
    if (!state || !state.players) return [];
    return [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
  }

  /**
   * Ordinal place label for a 1-based place number.
   *
   * @param {number} placeOneBased Place starting at 1.
   * @returns {string}
   */
  function ordinalPlace(placeOneBased) {
    const n = placeOneBased;
    const mod100 = n % 100;
    if (mod100 >= 11 && mod100 <= 13) return n + 'th';
    switch (n % 10) {
      case 1: return n + 'st';
      case 2: return n + 'nd';
      case 3: return n + 'rd';
      default: return n + 'th';
    }
  }

  /**
   * Reset place / outcome / trophy chrome on the win head.
   *
   * @returns {void}
   */
  function resetWinHeadChrome() {
    const placeEl = $('win-place');
    const outcomeEl = $('win-outcome');
    const head = document.querySelector('#win-overlay .win-head');
    const trophy = document.querySelector('#win-overlay .trophy');
    if (placeEl) {
      placeEl.hidden = true;
      placeEl.textContent = '';
    }
    if (outcomeEl) {
      outcomeEl.hidden = true;
      outcomeEl.textContent = '';
    }
    if (head) head.classList.remove('win-head-mid');
    if (trophy) {
      trophy.hidden = false;
      trophy.textContent = '🏆';
    }
  }

  function hideWinOverlay() {
    cancelWinCountUp();
    stopWinConfetti();
    pendingMatchStats = null;
    const banner = $('win-stats-banner');
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
    resetWinHeadChrome();
    $('win-overlay').classList.remove('show');
  }

  // ===================== RESULTS CONFETTI =====================
  const WIN_CONFETTI_COLORS = ['#ffd166', '#4f7cff', '#06d6a0', '#ff5d6c', '#c8bfff', '#ffffff'];
  const WIN_CONFETTI_SPAWN_MS = 2200;
  let winConfettiRaf = 0;
  let winConfettiParticles = [];
  let winConfettiSpawnAcc = 0;
  let winConfettiElapsed = 0;

  /**
   * @returns {boolean}
   */
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (err) {
      return false;
    }
  }

  /**
   * Size the confetti canvas to the win overlay.
   *
   * @returns {HTMLCanvasElement|null}
   */
  function sizeWinConfettiCanvas() {
    const canvas = $('win-confetti');
    const overlay = $('win-overlay');
    if (!canvas || !overlay) return null;
    const rect = overlay.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return canvas;
  }

  /**
   * Spawn confetti pieces near the top of the overlay.
   *
   * @param {number} count How many pieces to add.
   * @param {number} viewW Overlay width in CSS pixels.
   * @returns {void}
   */
  function spawnWinConfetti(count, viewW) {
    for (let i = 0; i < count; i += 1) {
      winConfettiParticles.push({
        x: Math.random() * viewW,
        y: -12 - Math.random() * 40,
        w: 5 + Math.random() * 5,
        h: 7 + Math.random() * 7,
        vx: -1.2 + Math.random() * 2.4,
        vy: 1.6 + Math.random() * 2.4,
        rot: Math.random() * Math.PI * 2,
        vr: -0.18 + Math.random() * 0.36,
        color: WIN_CONFETTI_COLORS[(Math.random() * WIN_CONFETTI_COLORS.length) | 0],
      });
    }
  }

  /**
   * Start a short confetti burst that slows and then stops.
   *
   * @returns {void}
   */
  function startWinConfetti() {
    stopWinConfetti();
    if (prefersReducedMotion()) return;
    const canvas = sizeWinConfettiCanvas();
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    winConfettiParticles = [];
    winConfettiSpawnAcc = 0;
    winConfettiElapsed = 0;
    spawnWinConfetti(56, canvas.clientWidth || 360);

    let last = performance.now();
    /**
     * @param {number} now
     * @returns {void}
     */
    function frame(now) {
      const overlay = $('win-overlay');
      if (!overlay || !overlay.classList.contains('show')) {
        stopWinConfetti();
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      winConfettiElapsed += dt * 1000;
      const w = canvas.clientWidth || 1;
      const h = canvas.clientHeight || 1;

      // Spawn slows to a stop over WIN_CONFETTI_SPAWN_MS, then drift only.
      if (winConfettiElapsed < WIN_CONFETTI_SPAWN_MS) {
        const t = winConfettiElapsed / WIN_CONFETTI_SPAWN_MS;
        const rate = (1 - t) * (1 - t);
        winConfettiSpawnAcc += dt * rate;
        if (winConfettiSpawnAcc >= 0.1) {
          winConfettiSpawnAcc = 0;
          const n = Math.max(1, Math.round(5 * rate));
          spawnWinConfetti(n, w);
        }
      }

      ctx.clearRect(0, 0, w, h);
      for (let i = winConfettiParticles.length - 1; i >= 0; i -= 1) {
        const p = winConfettiParticles[i];
        p.vy += 16 * dt;
        p.vx *= 0.995;
        p.x += p.vx * 60 * dt;
        p.y += p.vy * 60 * dt;
        p.rot += p.vr * (0.85 + 0.15 * Math.max(0, 1 - winConfettiElapsed / (WIN_CONFETTI_SPAWN_MS + 1800)));
        if (p.y > h + 30) {
          winConfettiParticles.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (winConfettiElapsed >= WIN_CONFETTI_SPAWN_MS && winConfettiParticles.length === 0) {
        stopWinConfetti();
        return;
      }
      winConfettiRaf = requestAnimationFrame(frame);
    }
    winConfettiRaf = requestAnimationFrame(frame);
  }

  /**
   * Stop results confetti and clear the canvas.
   *
   * @returns {void}
   */
  function stopWinConfetti() {
    if (winConfettiRaf) {
      cancelAnimationFrame(winConfettiRaf);
      winConfettiRaf = 0;
    }
    winConfettiParticles = [];
    winConfettiSpawnAcc = 0;
    winConfettiElapsed = 0;
    const canvas = $('win-confetti');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  /**
   * Returns true when a player won the given finished game state.
   *
   * @param {object|null} gameState Public game state.
   * @param {string|null} playerId Player socket id.
   * @returns {boolean}
   */
  function didPlayerWinForState(gameState, playerId) {
    if (!gameState || !gameState.finished || !playerId) return false;
    return GameModes.getModeForState(gameState).didPlayerWin(gameState, playerId);
  }

  /**
   * Returns true when the local player won the finished game.
   *
   * @returns {boolean}
   */
  function didCurrentPlayerWin() {
    return didPlayerWinForState(state, myId);
  }

  /**
   * Show or hide the signed-in win count banner on the end scorecard.
   *
   * @param {boolean} didWin Whether the local player won.
   */
  function updateWinStatsBanner(didWin) {
    const banner = $('win-stats-banner');
    if (!banner) return;
    if (!isSignedIn() || !didWin || !pendingMatchStats || typeof pendingMatchStats.matchesWon !== 'number') {
      banner.hidden = true;
      banner.textContent = '';
      return;
    }
    const winCount = pendingMatchStats.matchesWon;
    banner.hidden = false;
    banner.innerHTML = `You now have <strong>${winCount}</strong> ${winCount === 1 ? 'win' : 'wins'}!`;
  }

  /**
   * Show the end-game scorecard overlay.
   *
   * @param {{ force?: boolean }} [opts] When force is true, reopen even if dismissed.
   * @returns {void}
   */
  function showWin(opts) {
    if (!state || !state.finished) return;
    const force = !!(opts && opts.force);
    if (!force && isScorecardDone(state.code)) return;
    scorecardHold = true;

    currentMode().fillWinOverlay({
      state,
      myId,
      $,
      escapeHtml,
      playerCoinHtml,
      winScoreRightHtml,
      resetWinHeadChrome,
      ordinalPlace,
      sortedPlayersByScore,
      colorWithAlpha,
    });
    updateWinStatsBanner(didCurrentPlayerWin());
    revealWinOverlay();
  }

})();





