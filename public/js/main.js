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
  });

  let myId = null;
  let state = null;
  let lobbyWinsRefreshInFlight = false;
  const lobbyWinsRefreshAttempts = new Map();
  const selected = new Set(); // selected die indices for the current group
  let selSig = '';
  let autoEndTimer = null; // timer for auto-ending turn when no groups possible
  let colorPickerEl = null;
  let colorPickerOutsideHandler = null;
  let winCountUpFrames = [];
  let pendingMatchStats = null;

  const PLAYER_COLORS = [
    '#e63946', // red
    '#4f7cff', // blue
    '#06d6a0', // mint green
    '#ff6b9d', // pink
    '#1eb5db', // sky blue
    '#40916c', // forest green
    '#c1121f', // dark red
    '#1e40af', // navy blue
    '#22c55e', // grass green
    '#e67e22', // orange
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
      $('home-name').classList.add('input-error');
      $('home-name-error').textContent = isSignedIn()
        ? 'Please choose your GOAT name.'
        : 'Please enter your name.';
      return null;
    }
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
    return name;
  }

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name !== 'loading') {
      document.documentElement.classList.remove('mg-rejoining');
    }
    if (name === 'home') {
      const lb = document.getElementById('home-leaderboard-content');
      if (lb && lb.classList.contains('open')) {
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
  function playerCoinHtml(p, sizeClass) {
    const cls = 'swatch' + (sizeClass ? ' ' + sizeClass : '') + (p.id === myId ? ' me' : '');
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
  function getPlayerColors(p) {
    if (state && state.teamMode && state.teamPalettes) {
      if (p) {
        const team = state.teams && state.teams.find((t) => t.members.includes(p.id));
        if (team && state.teamPalettes[team.id]) {
          return state.teamPalettes[team.id];
        }
        const seen = new Set();
        const colors = [];
        state.teamPalettes.forEach((pal) => {
          pal.forEach((c) => {
            if (!seen.has(c)) {
              seen.add(c);
              colors.push(c);
            }
          });
        });
        if (colors.length) return colors;
      }
    }
    return (state && state.playerColors) || PLAYER_COLORS;
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
    // Stop team-row drag/select from stealing the gesture.
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

  // Enforce 4-digit limit on room code inputs
  $('join-code').addEventListener('input', function() {
    if (this.value.length > 4) this.value = this.value.slice(0, 4);
  });

  // Public rooms refresh timer
  let publicRoomsTimer = null;
  let leaderboardFetchedAt = 0;
  const LEADERBOARD_REFRESH_MS = 60000;

  // ===================== HOW TO PLAY / LEADERBOARD TOGGLES =====================
  document.querySelectorAll('.rules-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const content = document.getElementById(targetId);
      if (!content) return;
      const isOpen = content.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
      btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
      if (targetId === 'home-leaderboard-content' && isOpen) {
        fetchLeaderboardIfNeeded();
      }
    });
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
  $('home-name').addEventListener('focus', () => {
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
  });
  $('home-name').addEventListener('input', () => {
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
  });

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
    socket.emit('getPublicRooms', (rooms) => {
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
            <span class="pr-meta">${r.playerCount}/${r.maxPlayers} players · ${r.teamMode ? '👥 Team' : '🎯 Solo'}</span>
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

  function startPublicRoomsRefresh() {
    stopPublicRoomsRefresh();
    publicRoomsTimer = setInterval(refreshPublicRooms, 4000);
  }
  function stopPublicRoomsRefresh() {
    if (publicRoomsTimer) { clearInterval(publicRoomsTimer); publicRoomsTimer = null; }
  }

  // ===================== LOBBY ROOM SETTINGS =====================
  $('btn-private').addEventListener('click', () => {
    socket.emit('setRoomVisibility', { isPublic: false });
  });
  $('btn-public').addEventListener('click', () => {
    socket.emit('setRoomVisibility', { isPublic: true });
  });
  $('btn-maxp-down').addEventListener('click', () => {
    if (!state) return;
    const cur = state.maxPlayers || 6;
    if (cur > 2) socket.emit('setMaxPlayers', { maxPlayers: cur - 1 });
  });
  $('btn-maxp-up').addEventListener('click', () => {
    if (!state) return;
    const cur = state.maxPlayers || 6;
    if (cur < 6) socket.emit('setMaxPlayers', { maxPlayers: cur + 1 });
  });

  // ===================== LOBBY / NAV =====================
  $('btn-start').addEventListener('click', () => socket.emit('startGame'));
  $('btn-addbot').addEventListener('click', () => socket.emit('addBot'));
  // Team mode controls
  $('btn-teams-off').addEventListener('click', () => {
    if (!state || !state.teamMode) return;
    socket.emit('setTeamMode', { enabled: false });
  });
  $('btn-teams-on').addEventListener('click', () => {
    if (!state || state.teamMode) return;
    socket.emit('setTeamMode', { enabled: true });
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
   *
   * @param {Document} clonedDoc Document clone passed to html2canvas onclone.
   * @returns {void}
   */
  function prepareWinCardClone(clonedDoc) {
    if (!clonedDoc) return;
    const card = clonedDoc.querySelector('#win-overlay .overlay-card')
      || clonedDoc.querySelector('.overlay-card');
    if (!card) return;

    const actions = card.querySelector('.win-actions');
    if (actions) actions.style.display = 'none';

    const animated = card.querySelectorAll(
      '.win-head, .trophy, .score-row, .win-extra, .overlay-card'
    );
    animated.forEach((el) => {
      el.style.animation = 'none';
      el.style.opacity = '1';
      el.style.transform = 'none';
    });
    card.style.animation = 'none';
    card.style.opacity = '1';
    card.style.transform = 'none';

    const overlay = clonedDoc.getElementById('win-overlay');
    if (overlay) {
      overlay.style.animation = 'none';
      overlay.style.opacity = '1';
      overlay.style.transform = 'none';
    }

    card.querySelectorAll('.sb-count-score, .sb-count-tops').forEach((el) => {
      if (el.dataset.target != null && el.dataset.target !== '') {
        el.textContent = el.dataset.target;
      }
    });
  }

  function shareWinResult() {
    if (!state) return;
    const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
    const winnerSlots = winnerSlotCount(state.players.length);

    let standings = '';
    if (state.teamMode && state.teams) {
      const sortedTeams = [...state.teams].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.tops || 0) - (a.tops || 0));
      standings = sortedTeams.map((t, i) => {
        const prefix = teamRankPrefix(i);
        return `${prefix} Team ${t.name}: ${t.score || 0}pts`;
      }).join('\n');
    } else {
      standings = sorted.map((p, i) => {
        const prefix = scoreRankPrefix(i, winnerSlots);
        return `${prefix} ${p.name}: ${p.score}pts`;
      }).join('\n');
    }

    let winnerLine = '';
    if (state.teamMode && state.teams && state.winnerTeamId != null) {
      const winTeam = state.teams.find((t) => t.id === state.winnerTeamId);
      winnerLine = winTeam ? `Team ${winTeam.name} wins!` : 'Game over!';
    } else {
      const winnerIds = state.winnerPlayerIds && state.winnerPlayerIds.length
        ? state.winnerPlayerIds
        : (state.winnerId ? [state.winnerId] : []);
      const winners = winnerIds
        .map((id) => state.players.find((p) => p.id === id))
        .filter(Boolean);
      if (winners.length === 2) {
        winnerLine = `${winners[0].name} and ${winners[1].name} win!`;
      } else if (winners.length === 1) {
        winnerLine = `${winners[0].name} wins!`;
      } else {
        winnerLine = 'Game over!';
      }
    }

    const text = `🐐 Mountain Goats — ${winnerLine}\n\n${standings}\n\nPlay at: ${location.origin}`;

    // Try to capture the overlay card as an image
    const overlayCard = document.querySelector('#win-overlay .overlay-card');
    if (overlayCard && typeof html2canvas === 'function') {
      // Temporarily hide the action buttons for a cleaner screenshot
      const actions = overlayCard.querySelector('.win-actions');
      if (actions) actions.style.display = 'none';

      html2canvas(overlayCard, {
        backgroundColor: '#0d1424',
        scale: 2,
        useCORS: true,
        logging: false,
        onclone: (clonedDoc) => prepareWinCardClone(clonedDoc),
      }).then((canvas) => {
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
    const text = `Join my Mountain Goats game! Room code: ${state.code} - ${location.origin}`;
    if (navigator.share) navigator.share({ title: 'Mountain Goats', text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Invite copied!'));
    else toast('Room code: ' + state.code);
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
    if (window.MGSounds) {
      window.MGSounds.unlock();
      window.MGSounds.play({ type: 'ui_tap', self: true });
    }
    if (window.MGHaptics) window.MGHaptics.trigger({ type: 'ui_tap', self: true });
    socket.emit('rollDice');
    $('dice-area').classList.add('rolling');
    setTimeout(() => $('dice-area').classList.remove('rolling'), 500);
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
      const events = deriveFeedbackEvents(state, s, myId);
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

  let teamDragState = null;

  /**
   * Returns true when this client may move the given player between teams.
   *
   * @param {string} playerId Player socket id.
   * @param {boolean} amHost Whether local user is host.
   * @returns {boolean}
   */
  function canMoveTeamPlayer(playerId, amHost) {
    if (!state || !state.teamMode || !state.teams || state.teams.length < 1) return false;
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
    if (!state || !state.teamMode || !state.teams) return;
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
    appendKickBtn(li, p, amHost);
    attachLobbySwatch(li, p);

    const movable = canMoveTeamPlayer(p.id, amHost) && state.teams && state.teams.length > 0;
    if (movable) {
      li.classList.add('team-movable');
      li.title = amHost
        ? 'Drag to another team'
        : 'Drag yourself to another team';
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
   * Find team band element under a point.
   *
   * @param {number} clientX X coordinate.
   * @param {number} clientY Y coordinate.
   * @returns {HTMLElement|null}
   */
  function teamBandFromPoint(clientX, clientY) {
    const stack = typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : [document.elementFromPoint(clientX, clientY)].filter(Boolean);
    for (let i = 0; i < stack.length; i++) {
      const el = stack[i];
      if (!el || !el.closest) continue;
      if (el.classList && el.classList.contains('dragging')) continue;
      const band = el.closest('.team-band');
      if (band) return band;
    }
    return null;
  }

  /**
   * Wire pointer drag on team bands in the lobby list.
   *
   * @param {HTMLElement} listRoot Lobby players list element.
   * @param {boolean} amHost Whether local user is host.
   * @returns {void}
   */
  function wireTeamBandInteractions(listRoot, amHost) {
    const DRAG_THRESHOLD = 8;

    listRoot.querySelectorAll('.team-member.team-movable').forEach((row) => {
      row.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest && (
          e.target.closest('.kick-btn')
          || e.target.closest('.swatch-clickable')
          || e.target.closest('.swatch')
          || e.target.closest('button')
        )) return;

        const playerId = row.dataset.playerId;
        if (!playerId || !canMoveTeamPlayer(playerId, amHost)) return;

        // Claim the gesture immediately so page scroll cannot cancel it.
        e.preventDefault();
        try { row.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        const sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();

        teamDragState = {
          playerId,
          fromTeamId: row.dataset.fromTeamId != null && row.dataset.fromTeamId !== ''
            ? Number(row.dataset.fromTeamId)
            : null,
          startX: e.clientX,
          startY: e.clientY,
          dragging: false,
          pointerId: e.pointerId,
          row,
        };

        const onMove = (ev) => {
          if (!teamDragState || teamDragState.pointerId !== ev.pointerId) return;
          ev.preventDefault();
          const dx = ev.clientX - teamDragState.startX;
          const dy = ev.clientY - teamDragState.startY;
          if (!teamDragState.dragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
            teamDragState.dragging = true;
            row.classList.add('dragging');
            listRoot.classList.add('is-dragging');
            if (sel && sel.removeAllRanges) sel.removeAllRanges();
          }
          if (!teamDragState.dragging) return;
          listRoot.querySelectorAll('.team-band.drag-over').forEach((b) => b.classList.remove('drag-over'));
          const band = teamBandFromPoint(ev.clientX, ev.clientY);
          if (band && band.dataset.teamId !== '' && Number(band.dataset.teamId) !== teamDragState.fromTeamId) {
            band.classList.add('drag-over');
          }
        };

        const onUp = (ev) => {
          if (!teamDragState || teamDragState.pointerId !== ev.pointerId) return;
          row.removeEventListener('pointermove', onMove);
          row.removeEventListener('pointerup', onUp);
          row.removeEventListener('pointercancel', onUp);
          try { row.releasePointerCapture(ev.pointerId); } catch (err) { /* ignore */ }

          const wasDragging = teamDragState.dragging;
          const pid = teamDragState.playerId;
          const fromId = teamDragState.fromTeamId;
          row.classList.remove('dragging');
          listRoot.classList.remove('is-dragging');
          listRoot.querySelectorAll('.team-band.drag-over').forEach((b) => b.classList.remove('drag-over'));
          teamDragState = null;

          if (!wasDragging) return;
          const band = teamBandFromPoint(ev.clientX, ev.clientY);
          if (band && band.dataset.teamId !== '') {
            const toId = Number(band.dataset.teamId);
            if (Number.isFinite(toId) && toId !== fromId) {
              emitTeamMove(pid, toId);
            }
          }
        };

        row.addEventListener('pointermove', onMove, { passive: false });
        row.addEventListener('pointerup', onUp);
        row.addEventListener('pointercancel', onUp);
      }, { passive: false });
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
        $('maxp-display').textContent = state.maxPlayers || 6;
        $('btn-maxp-down').disabled = (state.maxPlayers || 6) <= Math.max(2, state.players.length);
        $('btn-maxp-up').disabled = (state.maxPlayers || 6) >= 6;
      }
    }

    const ul = $('lobby-players');
    ul.innerHTML = '';
    ul.classList.toggle('team-lobby', !!(state.teamMode && state.teams));

    if (state.teamMode && state.teams) {
      state.teams.forEach((team) => {
        ul.appendChild(buildTeamBand(team, amHost));
      });

      const assigned = new Set(state.teams.flatMap((t) => t.members));
      const unassigned = state.players.filter((p) => !assigned.has(p.id));
      if (unassigned.length) {
        ul.appendChild(buildUnassignedBand(unassigned, amHost));
      }

      wireTeamBandInteractions(ul, amHost);
    } else {
      // Standard mode: render flat player list
      state.players.forEach((p) => {
        const li = document.createElement('li');
        if (p.id === myId) li.classList.add('lobby-you');
        li.innerHTML = lobbyPlayerRowHtml(p, lobbyPlayerBadgesHtml(p, ''));
        appendKickBtn(li, p, amHost);
        attachLobbySwatch(li, p);
        ul.appendChild(li);
      });
    }

    // Game mode + team count (host only, inside room settings).
    const teamsOffBtn = $('btn-teams-off');
    const teamsOnBtn = $('btn-teams-on');
    const teamConfigRow = $('team-config-row');
    if (amHost && teamsOffBtn && teamsOnBtn) {
      teamsOffBtn.classList.toggle('active', !state.teamMode);
      teamsOnBtn.classList.toggle('active', !!state.teamMode);
      if (teamConfigRow) {
        teamConfigRow.hidden = !state.teamMode;
        if (state.teamMode && state.teams) {
          const numTeams = state.teams.length;
          $('btn-2teams').classList.toggle('active', numTeams === 2);
          $('btn-3teams').classList.toggle('active', numTeams === 3);
          $('btn-3teams').style.display = '';
        }
      }
    }

    const teamMoveHint = $('team-move-hint');
    if (teamMoveHint) {
      const showHint = !!(state.teamMode && state.teams);
      teamMoveHint.hidden = !showHint;
      if (showHint) {
        teamMoveHint.textContent = amHost
          ? 'Drag players onto another team to change teams.'
          : 'Drag your row onto another team to switch.';
      }
    }

    const startBtn = $('btn-start');
    const addBtn = $('btn-addbot');
    startBtn.style.display = amHost ? 'block' : 'none';
    addBtn.style.display = amHost ? 'block' : 'none';
    addBtn.disabled = state.players.length >= (state.maxPlayers || 6);

    // Check if teams are equal (required to start in team mode)
    let teamsUnequal = false;
    if (state.teamMode && state.teams && state.teams.length >= 2) {
      const sizes = state.teams.map((t) => t.members.length);
      teamsUnequal = sizes.some((s) => s !== sizes[0]) || sizes.some((s) => s === 0);
    }

    startBtn.disabled = state.players.length < 2 || teamsUnequal;
    if (amHost) {
      if (state.players.length < 2) {
        $('lobby-hint').textContent = 'Add a bot or wait for a friend to join.';
      } else if (teamsUnequal) {
        $('lobby-hint').textContent = '⚠️ Teams must be equal to start!';
        $('lobby-hint').style.color = 'var(--danger)';
      } else {
        $('lobby-hint').textContent = state.teamMode ? 'Teams ready! Start when you are!' : 'Ready when you are!';
        $('lobby-hint').style.color = '';
      }
    } else {
      $('lobby-hint').textContent = 'Waiting for the host to start…';
      $('lobby-hint').style.color = '';
    }
  }

  function renderGame() {
    try { $('game-code').textContent = state.code; } catch(e) {}
    syncSelection();
    try { renderTurnBanner(); } catch(e) { console.error('renderTurnBanner', e); }
    try { renderStats(); } catch(e) { console.error('renderStats', e); }
    try { renderBonusRow(); } catch(e) { console.error('renderBonusRow', e); }
    try { renderBoard(); } catch(e) { console.error('renderBoard', e); }
    try { renderDice(); } catch(e) { console.error('renderDice', e); }
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

    if (state.teamMode && state.teams) {
      // Team mode: display team scorecards
      // Build ordered member lists per team based on actual turn order
      const teamOrder = state.teams.map(() => []);
      state.players.forEach((p) => {
        const tIdx = state.teams.findIndex((t) => t.members.includes(p.id));
        if (tIdx >= 0) teamOrder[tIdx].push(p);
      });

      // All team configs: stacked vertically, each team as a block with members in a row
      state.teams.forEach((t, tIdx) => {
        const teamBlock = document.createElement('div');
        teamBlock.className = 'team-block';
        teamBlock.style.setProperty('--tc', t.color);

        // Team header
        const head = document.createElement('div');
        head.className = 'tg-head';
        head.style.setProperty('--tc', t.color);
        head.innerHTML = `<span class="tg-dot" style="background:${t.color}"></span>
          <span class="tg-name">${escapeHtml(t.name)}</span>
          <span class="tg-score">⭐ ${t.score || 0}</span>`;
        teamBlock.appendChild(head);

        // Members in a row
        const membersRow = document.createElement('div');
        membersRow.className = 'team-block-members';
        teamOrder[tIdx].forEach((p) => {
          membersRow.appendChild(buildPlayerPanel(p));
        });
        teamBlock.appendChild(membersRow);
        strip.appendChild(teamBlock);
      });

      // Helper to build a player panel
      function buildPlayerPanel(p) {
        const idx = state.players.indexOf(p);
        const panel = document.createElement('div');
        panel.className = 'pp team-pp' + (idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off');
        const pos = p.pos || [];
        const collected = p.collected || [];
        let chips = '';
        state.mountains.forEach((m, mi) => {
          const onTop = (pos[mi] || 0) >= m.height;
          const n = collected[mi] || 0;
          chips += `<span class="pp-chip${n > 0 ? ' has' : ''}${onTop ? ' top' : ''}" style="--c:${m.color}">${m.value}<b>×${n}</b></span>`;
        });
        const bonusTag = p.bonus && p.bonus.length ? `<span class="pp-bonus">✨${p.bonusPoints || 0}</span>` : '';
        panel.innerHTML = `
          <div class="pp-head">
            ${playerCoinHtml(p, 'sm')}
            <span class="pp-name">${escapeHtml(p.name)}</span>
            ${bonusTag}<span class="pp-score">⭐ ${p.score || 0}</span>
          </div>
          <div class="pp-mtns">${chips}</div>`;
        return panel;
      }
    } else {
      // Standard mode: flat player panels
      state.players.forEach((p, idx) => {
        const panel = document.createElement('div');
        panel.className = 'pp' + (idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off');
        const pos = p.pos || [];
        const collected = p.collected || [];
        let chips = '';
        state.mountains.forEach((m, mi) => {
          const onTop = (pos[mi] || 0) >= m.height;
          const n = collected[mi] || 0;
          chips += `<span class="pp-chip${n > 0 ? ' has' : ''}${onTop ? ' top' : ''}" style="--c:${m.color}">${m.value}<b>×${n}</b></span>`;
        });
        const bonusTag = p.bonus && p.bonus.length ? `<span class="pp-bonus">✨${p.bonusPoints || 0}</span>` : '';
        panel.innerHTML = `
          <div class="pp-head">
            ${playerCoinHtml(p, 'sm')}
            <span class="pp-name">${escapeHtml(p.name)}</span>
            ${bonusTag}<span class="pp-score">⭐ ${p.score || 0}</span>
          </div>
          <div class="pp-mtns">${chips}</div>`;
        strip.appendChild(panel);
      });
    }
  }

  function renderBonusRow() {
    const row = $('bonus-row');
    if (!row) return;
    const all = [15, 12, 9, 6];
    const remaining = state.bonusTokens || [];
    row.innerHTML = '<span class="bonus-label">Bonus</span>' + all
      .map((v) => `<span class="bonus-tok${remaining.includes(v) ? '' : ' gone'}">✨${v}</span>`)
      .join('');
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

      // tooltip-ish header: tokens remaining
      const head = document.createElement('div');
      head.className = 'mhead';
      head.innerHTML = `<span class="mtok" style="--c:${m.color}">${m.value}</span>
        <span class="mleft">${m.chips > 0 ? '×' + m.chips : 'closed'}</span>`;
      col.appendChild(head);

      // climbing track: top space (pos=height) down to bottom (pos=1)
      const track = document.createElement('div');
      track.className = 'track';
      for (let p = m.height; p >= 1; p--) {
        const wrap = document.createElement('div');
        wrap.className = 'cell-wrap';
        const cell = document.createElement('div');
        cell.className = 'cell' + (p === m.height ? ' top' : '');
        cell.style.setProperty('--c', m.color);
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
    state.dice.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = 'die'
        + (state.diceUsed[i] ? ' used' : '')
        + (selected.has(i) ? ' sel' : '');
      d.textContent = v;
      if (mine && !state.diceUsed[i]) {
        d.addEventListener('click', () => {
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          renderGame();
        });
      }
      // 1s re-face control
      if (mine && noneUsed && state.adjustable && state.adjustable.includes(i)) {
        const btn = document.createElement('button');
        btn.className = 'reface';
        btn.textContent = '↻';
        btn.title = 'Change this 1 to any face';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('adjustDie', { index: i, value: (v % 6) + 1 });
        });
        d.appendChild(btn);
      }
      area.appendChild(d);
    });
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

  function endReasonBadge(reason, extraIndex) {
    if (!reason) return '';
    const style = extraIndex != null ? ` style="--i:${extraIndex}"` : '';
    const cls = extraIndex != null ? 'end-reason win-extra' : 'end-reason';
    if (reason === 'bonus') {
      return `<div class="${cls}"${style}>
        <span class="er-icon">✨</span>
        <span>All 4 Bonus Tokens were claimed — the final round was triggered.</span>
      </div>`;
    }
    return `<div class="${cls}"${style}>
      <span class="er-icon">🏔️</span>
      <span>3 mountains ran out of Point Tokens — the final round was triggered.</span>
    </div>`;
  }

  function winScoreRightHtml(score, tops) {
    const s = score || 0;
    const t = tops || 0;
    return `<span class="sb-right"><span class="sb-count-score" data-target="${s}">0</span> pts · 👑<span class="sb-count-tops" data-target="${t}">0</span></span>`;
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
    const els = document.querySelectorAll('#win-overlay .sb-count-score, #win-overlay .sb-count-tops');
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
      row.querySelectorAll('.sb-count-tops').forEach((el) => {
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
  }

  /**
   * Winner slots in standard mode: 1 for 2-4 players, 2 for 5-6.
   *
   * @param {number} playerCount Number of players in the game.
   * @returns {number}
   */
  function winnerSlotCount(playerCount) {
    return playerCount >= 5 ? 2 : 1;
  }

  /**
   * Rank prefix for a standard-mode scorecard row.
   *
   * @param {number} rankIndex Zero-based rank in sorted standings.
   * @param {number} winnerSlots Number of winner slots for this game.
   * @returns {string}
   */
  function scoreRankPrefix(rankIndex, winnerSlots) {
    if (rankIndex === 0) return '🥇';
    if (rankIndex === 1 && winnerSlots >= 2) return '🥈';
    return String(rankIndex + 1);
  }

  /**
   * Rank prefix HTML for a standard-mode scorecard row.
   *
   * @param {number} rankIndex Zero-based rank in sorted standings.
   * @param {number} winnerSlots Number of winner slots for this game.
   * @returns {string}
   */
  function scoreRankPrefixHtml(rankIndex, winnerSlots) {
    const prefix = scoreRankPrefix(rankIndex, winnerSlots);
    if (prefix === '🥇' || prefix === '🥈') return prefix;
    return `<span class="sb-rank-num">${prefix}</span>`;
  }

  /**
   * Rank prefix for a team-mode scorecard row (gold for 1st only).
   *
   * @param {number} rankIndex Zero-based rank in sorted team standings.
   * @returns {string}
   */
  function teamRankPrefix(rankIndex) {
    return rankIndex === 0 ? '🥇' : String(rankIndex + 1);
  }

  /**
   * Rank prefix HTML for a team-mode scorecard row.
   *
   * @param {number} rankIndex Zero-based rank in sorted team standings.
   * @returns {string}
   */
  function teamRankPrefixHtml(rankIndex) {
    const prefix = teamRankPrefix(rankIndex);
    if (prefix === '🥇') return prefix;
    return `<span class="sb-rank-num">${prefix}</span>`;
  }

  /**
   * Returns true when a player id is among the standard-mode winners.
   *
   * @param {string} playerId Player socket id.
   * @returns {boolean}
   */
  function isStandardWinner(playerId) {
    if (!state) return false;
    const winnerIds = state.winnerPlayerIds && state.winnerPlayerIds.length
      ? state.winnerPlayerIds
      : (state.winnerId ? [state.winnerId] : []);
    return winnerIds.includes(playerId);
  }

  /** Fixed catchphrases by zero-based place (standard mode, local player). */
  const STANDARD_PLACE_PHRASES = [
    'You are the real GOAT!',
    'Almost claimed the summit',
    'Solid climb - keep hoofing',
    'The mountain remembers',
    'Every goat starts at base',
    "Next summit's yours",
  ];

  /**
   * Build the standard-mode win overlay title (share / fallback).
   *
   * @returns {string}
   */
  function standardWinTitle() {
    if (didCurrentPlayerWin()) return 'You Win! 🎉';
    const slots = winnerSlotCount(state.players.length);
    const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
    if (slots === 2 && sorted[1]) {
      return `${sorted[0].name} and ${sorted[1].name} Win!`;
    }
    const winner = state.players.find((p) => p.id === state.winnerId);
    return winner ? `${winner.name} Wins!` : 'Game Over!';
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
   * Catchphrase for the local player's place in standard mode.
   *
   * @param {number} rankIndex Zero-based rank in sorted standings.
   * @param {number} winnerSlots Number of winner slots for this game.
   * @returns {string}
   */
  function standardCatchphrase(rankIndex, winnerSlots) {
    if (rankIndex === 1 && winnerSlots >= 2) return 'Shared summit!';
    if (rankIndex >= 0 && rankIndex < STANDARD_PLACE_PHRASES.length) {
      return STANDARD_PLACE_PHRASES[rankIndex];
    }
    return STANDARD_PLACE_PHRASES[STANDARD_PLACE_PHRASES.length - 1];
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

  /**
   * Fill standard-mode place line, catchphrase, trophy, and outcome subline.
   *
   * @param {object|null} winner Top-ranked or designated winner player.
   * @returns {void}
   */
  function applyStandardWinHead(winner) {
    const placeEl = $('win-place');
    const outcomeEl = $('win-outcome');
    const titleEl = $('win-title');
    const head = document.querySelector('#win-overlay .win-head');
    const trophy = document.querySelector('#win-overlay .trophy');
    const sorted = sortedPlayersByScore();
    const rankIndex = sorted.findIndex((p) => p.id === myId);
    const winnerSlots = winnerSlotCount(state.players.length);
    const localWon = didCurrentPlayerWin();

    if (rankIndex < 0) {
      resetWinHeadChrome();
      titleEl.textContent = winner ? standardWinTitle() : 'Game Over!';
      return;
    }

    if (placeEl) {
      placeEl.hidden = false;
      placeEl.textContent = ordinalPlace(rankIndex + 1) + ' place';
    }
    titleEl.textContent = standardCatchphrase(rankIndex, winnerSlots);
    if (trophy) {
      trophy.textContent = localWon ? '🏆' : '';
      trophy.hidden = !localWon;
    }
    if (head) head.classList.toggle('win-head-mid', !localWon);

    if (outcomeEl) {
      if (!localWon && winner) {
        outcomeEl.hidden = false;
        outcomeEl.textContent = winner.name + ' won with ' + winner.score + ' pts';
      } else {
        outcomeEl.hidden = true;
        outcomeEl.textContent = '';
      }
    }
  }

  /** Fixed catchphrases by zero-based team place (team mode, local herd). */
  const TEAM_PLACE_PHRASES = [
    'The GOAT team won!',
    'Almost owned the ridge',
    'Base camp builds champions',
  ];

  /**
   * Teams sorted by score then tops (same order as the team scoreboard).
   *
   * @returns {object[]}
   */
  function sortedTeamsByScore() {
    if (!state || !state.teams) return [];
    return [...state.teams].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.tops || 0) - (a.tops || 0));
  }

  /**
   * Zero-based rank of the local player's team in sorted standings.
   *
   * @param {object[]} sortedTeams Teams sorted by score.
   * @returns {number}
   */
  function localTeamRankIndex(sortedTeams) {
    return sortedTeams.findIndex((t) => t.members && t.members.includes(myId));
  }

  /**
   * Catchphrase for the local player's team place.
   *
   * @param {number} rankIndex Zero-based team rank.
   * @returns {string}
   */
  function teamCatchphrase(rankIndex) {
    if (rankIndex >= 0 && rankIndex < TEAM_PLACE_PHRASES.length) {
      return TEAM_PLACE_PHRASES[rankIndex];
    }
    return TEAM_PLACE_PHRASES[TEAM_PLACE_PHRASES.length - 1];
  }

  /**
   * Fill team-mode place line, catchphrase, trophy, and outcome subline.
   *
   * @param {object} winTeam Winning team object.
   * @param {object[]} sortedTeams Teams sorted by score.
   * @returns {void}
   */
  function applyTeamWinHead(winTeam, sortedTeams) {
    const placeEl = $('win-place');
    const outcomeEl = $('win-outcome');
    const titleEl = $('win-title');
    const head = document.querySelector('#win-overlay .win-head');
    const trophy = document.querySelector('#win-overlay .trophy');
    const rankIndex = localTeamRankIndex(sortedTeams);
    const localWon = didCurrentPlayerWin();

    if (rankIndex < 0) {
      resetWinHeadChrome();
      titleEl.textContent = winTeam ? `Team ${winTeam.name} Wins!` : 'Game Over!';
      return;
    }

    if (placeEl) {
      placeEl.hidden = false;
      placeEl.textContent = ordinalPlace(rankIndex + 1) + ' place';
    }
    titleEl.textContent = teamCatchphrase(rankIndex);
    if (trophy) {
      trophy.textContent = localWon ? '🏆' : '';
      trophy.hidden = !localWon;
    }
    if (head) head.classList.toggle('win-head-mid', !localWon);

    if (outcomeEl) {
      if (!localWon && winTeam) {
        outcomeEl.hidden = false;
        outcomeEl.textContent = 'Team ' + winTeam.name + ' took the peak · ' + (winTeam.score || 0) + ' pts';
      } else {
        outcomeEl.hidden = true;
        outcomeEl.textContent = '';
      }
    }
  }

  /**
   * Build rivalry HTML for a 2-team scorecard.
   *
   * @param {object[]} sortedTeams Exactly two teams, sorted by score.
   * @param {object} winTeam Winning team.
   * @returns {string}
   */
  function teamRivalryHtml(sortedTeams, winTeam) {
    const a = sortedTeams[0];
    const b = sortedTeams[1];
    const total = (a.score || 0) + (b.score || 0);
    const pctA = total > 0 ? Math.round(((a.score || 0) / total) * 100) : 50;
    const pctB = 100 - pctA;
    const side = (t, i) => {
      const isWin = t.id === winTeam.id;
      return `<div class="win-rival-side${isWin ? ' winner' : ''} win-extra" style="--i:${i};--team-color:${escapeHtml(t.color)}">
        <div class="win-rival-name" style="color:${escapeHtml(t.color)}">${escapeHtml(t.name)}</div>
        <div class="win-rival-score">${t.score || 0}</div>
      </div>`;
    };
    return `<div class="win-rival">
      ${side(a, 0)}
      <div class="win-rival-vs win-extra" style="--i:0">VS</div>
      ${side(b, 1)}
    </div>
    <div class="win-bar-track win-extra" style="--i:1">
      <div class="win-bar-seg" style="width:${pctA}%;background:${escapeHtml(a.color)}"></div>
      <div class="win-bar-seg" style="width:${pctB}%;background:${escapeHtml(b.color)}"></div>
    </div>`;
  }

  /**
   * Build podium HTML for a 3-team scorecard.
   *
   * @param {object[]} sortedTeams At least three teams, sorted by score.
   * @returns {string}
   */
  function teamPodiumHtml(sortedTeams) {
    const first = sortedTeams[0];
    const second = sortedTeams[1];
    const third = sortedTeams[2];
    const pod = (t, placeClass, placeLabel, i) => {
      if (!t) return '';
      return `<div class="win-pod ${placeClass} win-extra" style="--i:${i};--team-color:${escapeHtml(t.color)}">
        <div class="win-pod-place">${placeLabel}</div>
        <div class="win-pod-name" style="color:${escapeHtml(t.color)}">${escapeHtml(t.name)}</div>
        <div class="win-pod-height"><span class="win-pod-bar-score">${t.score || 0}</span></div>
      </div>`;
    };
    return `<div class="win-podium">
      ${pod(second, 'second', '2nd', 0)}
      ${pod(first, 'first', '1st', 1)}
      ${pod(third, 'third', '3rd', 2)}
    </div>`;
  }

  function hideWinOverlay() {
    cancelWinCountUp();
    pendingMatchStats = null;
    const banner = $('win-stats-banner');
    if (banner) {
      banner.hidden = true;
      banner.textContent = '';
    }
    resetWinHeadChrome();
    $('win-overlay').classList.remove('show');
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
    if (gameState.teamMode && gameState.teams && gameState.winnerTeamId != null) {
      const winTeam = gameState.teams.find((team) => team.id === gameState.winnerTeamId);
      const playerTeam = gameState.teams.find((team) => team.members.includes(playerId));
      return !!(winTeam && playerTeam && playerTeam.id === winTeam.id);
    }
    const winnerIds = gameState.winnerPlayerIds && gameState.winnerPlayerIds.length
      ? gameState.winnerPlayerIds
      : (gameState.winnerId ? [gameState.winnerId] : []);
    return winnerIds.includes(playerId);
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

    let winner = state.players.find((p) => p.id === state.winnerId) || null;
    if (!winner && state.winnerPlayerIds && state.winnerPlayerIds.length) {
      winner = state.players.find((p) => p.id === state.winnerPlayerIds[0]) || null;
    }
    if (!winner) {
      const ranked = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
      winner = ranked[0] || null;
    }

    if (state.teamMode && state.teams && state.winnerTeamId != null) {
      // Team mode win screen: rivalry (2) or podium (3)
      const winTeam = state.teams.find((t) => t.id === state.winnerTeamId);
      if (!winTeam) {
        resetWinHeadChrome();
        $('win-title').textContent = 'Game Over!';
        $('win-sub').innerHTML = '';
        updateWinStatsBanner(didCurrentPlayerWin());
        revealWinOverlay();
        return;
      }

      const sortedTeams = sortedTeamsByScore();
      applyTeamWinHead(winTeam, sortedTeams);

      let teamViz = '';
      let vizRows = 2;
      if (sortedTeams.length === 2) {
        teamViz = teamRivalryHtml(sortedTeams, winTeam);
        vizRows = 2;
      } else if (sortedTeams.length >= 3) {
        teamViz = teamPodiumHtml(sortedTeams);
        vizRows = 3;
      }

      let rowIdx = vizRows;
      const labelIdx = rowIdx++;
      const sorted = sortedPlayersByScore();
      const playerRows = sorted.map((p) => {
        const bonusTag = p.bonus && p.bonus.length ? ` <span class="sb-bonus">✨+${p.bonusPoints}</span>` : '';
        const team = state.teams.find((t) => t.members.includes(p.id));
        const teamBorder = team ? `border-color:${escapeHtml(team.color)}` : '';
        const idx = rowIdx++;
        return `<div class="score-row score-row-sm" style="--i:${idx};${teamBorder}">
          <span class="sb-left">${playerCoinHtml(p, 'sm')} ${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${bonusTag}</span>
          ${winScoreRightHtml(p.score, p.tops)}
        </div>`;
      }).join('');
      const extraIdx = rowIdx;

      $('win-sub').innerHTML = `${teamViz}
        <div class="team-breakdown-label win-extra" style="--i:${labelIdx}">Individual Scores</div>
        <div class="scoreboard scoreboard-sm">${playerRows}</div>
        ${endReasonBadge(state.endReason, extraIdx)}`;
      document.querySelector('#win-overlay .win-actions').style.setProperty('--rows', String(rowIdx));
    } else {
      // Standard mode win screen
      if (winner) applyStandardWinHead(winner);
      else {
        resetWinHeadChrome();
        $('win-title').textContent = 'Game Over!';
      }
      const sorted = sortedPlayersByScore();
      const winnerSlots = winnerSlotCount(state.players.length);
      const rows = sorted.map((p, i) => {
        const prefix = scoreRankPrefixHtml(i, winnerSlots);
        const isWinner = i < winnerSlots;
        const bonusTag = p.bonus && p.bonus.length ? ` <span class="sb-bonus">✨+${p.bonusPoints}</span>` : '';
        return `<div class="score-row${isWinner ? ' win' : ''}" style="--i:${i}">
          <span class="sb-left">${prefix} ${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${bonusTag}</span>
          ${winScoreRightHtml(p.score, p.tops)}
        </div>`;
      }).join('');

      // Only show tie-break note if it actually mattered.
      let extraIdx = sorted.length;
      let tieNote = '';
      if (winner) {
        const topScore = winner.score;
        const tied = state.players.filter((p) => p.score === topScore);
        if (tied.length > 1) {
          const topTops = winner.tops;
          const tiedOnTops = tied.filter((p) => p.tops === topTops);
          if (tiedOnTops.length > 1) {
            tieNote = `<div class="tiebreak win-extra" style="--i:${extraIdx++}">🏔️ Tie broken by goat on the higher-numbered mountain.</div>`;
          } else {
            tieNote = `<div class="tiebreak win-extra" style="--i:${extraIdx++}">👑 Tie broken by most goats on mountain tops.</div>`;
          }
        }
      }

      $('win-sub').innerHTML = `<div class="scoreboard">${rows}</div>
        ${tieNote}
        ${endReasonBadge(state.endReason, extraIdx)}`;
      document.querySelector('#win-overlay .win-actions').style.setProperty('--rows', String(sorted.length));
    }
    updateWinStatsBanner(didCurrentPlayerWin());
    revealWinOverlay();
  }
})();





