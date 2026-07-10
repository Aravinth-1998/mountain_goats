/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;
  const GAMING_NAME_KEY = 'gaming_name';
  const GAMING_NAME_CACHE_KEY = 'mg_gaming_name';
  const AVATAR_URL_CACHE_KEY = 'mg_avatar_url';

  let supabaseClient = null;
  let configured = false;
  let profile = { isSignedIn: false, userId: '', avatarUrl: null, displayName: '' };
  let statsSidebarBound = false;
  let profileDrawerClosing = false;
  const PROFILE_DRAWER_MS = 280;
  let resolveAuthBootstrapped = null;
  let resolveAuthReady = null;

  /**
   * Truncate a name to the game name limit.
   *
   * @param {string} raw Raw name string.
   * @returns {string}
   */
  function truncateName(raw) {
    return String(raw || '').trim().slice(0, NAME_MAX_LEN);
  }

  /**
   * Resolve avatar URL from Supabase user metadata.
   *
   * @param {object|null} user Supabase user object.
   * @returns {string|null}
   */
  function avatarUrlFromUser(user) {
    if (!user || !user.user_metadata) return null;
    const meta = user.user_metadata;
    return meta.avatar_url || meta.picture || null;
  }

  /**
   * Resolve a display name for avatar fallbacks.
   *
   * @param {object|null} user Supabase user object.
   * @returns {string}
   */
  function displayNameFromUser(user) {
    if (!user) return 'Player';
    const meta = user.user_metadata || {};
    const raw =
      meta.full_name ||
      meta.name ||
      (user.email ? String(user.email).split('@')[0] : '') ||
      'Player';
    const name = String(raw).trim();
    return name || 'Player';
  }

  /**
   * Build a fallback avatar URL when Google photo is unavailable.
   *
   * @param {string} name Display name for initials.
   * @returns {string}
   */
  function buildAvatarFallbackUrl(name) {
    const encoded = encodeURIComponent(name || 'Player');
    return `https://ui-avatars.com/api/?name=${encoded}&background=4f7cff&color=fff&size=72`;
  }

  /**
   * Read cached avatar URL for faster reload display.
   *
   * @returns {string|null}
   */
  function readCachedAvatarUrl() {
    const url = localStorage.getItem(AVATAR_URL_CACHE_KEY);
    return url ? String(url) : null;
  }

  /**
   * Persist a successfully loaded Google avatar URL.
   *
   * @param {string} url Avatar URL that loaded successfully.
   */
  function cacheAvatarUrl(url) {
    if (!url) return;
    localStorage.setItem(AVATAR_URL_CACHE_KEY, url);
  }

  /**
   * Clear cached avatar URL on sign-out.
   */
  function clearCachedAvatarUrl() {
    localStorage.removeItem(AVATAR_URL_CACHE_KEY);
  }

  /**
   * Apply avatar src with Google-safe referrer policy and initials fallback on load failure.
   *
   * @param {HTMLImageElement} img Avatar image element.
   * @param {string|null} primaryUrl Google/Supabase avatar URL.
   * @param {string} displayName Display name for alt text and fallback initials.
   */
  function setAvatarImage(img, primaryUrl, displayName) {
    if (!img) return;

    const name = displayName || 'Player';
    const fallbackUrl = buildAvatarFallbackUrl(name);
    const resolvedPrimary = primaryUrl || readCachedAvatarUrl();
    const usePrimary = resolvedPrimary && resolvedPrimary !== fallbackUrl;

    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.alt = name ? `${name} profile photo` : 'Your profile photo';
    img.removeAttribute('data-avatar-fallback');

    img.onload = null;
    img.onerror = null;

    if (!usePrimary) {
      img.src = fallbackUrl;
      return;
    }

    img.onerror = () => {
      img.onerror = null;
      img.onload = null;
      img.dataset.avatarFallback = '1';
      img.src = fallbackUrl;
    };

    img.onload = () => {
      if (img.dataset.avatarFallback === '1') return;
      img.onerror = null;
      cacheAvatarUrl(resolvedPrimary);
    };

    img.src = resolvedPrimary;
  }

  /**
   * Build profile state from a Supabase session user.
   *
   * @param {object|null} user Supabase user or null when signed out.
   * @returns {{isSignedIn: boolean, userId: string, avatarUrl: string|null, displayName: string}}
   */
  function profileFromUser(user) {
    if (!user) {
      return { isSignedIn: false, userId: '', avatarUrl: null, displayName: '' };
    }
    return {
      isSignedIn: true,
      userId: user.id || '',
      avatarUrl: avatarUrlFromUser(user),
      displayName: displayNameFromUser(user),
    };
  }

  /**
   * Read gaming name from Supabase Auth user metadata (syncs cross-device).
   *
   * @param {object|null} user Supabase user object.
   * @returns {string|null}
   */
  function gamingNameFromUserMetadata(user) {
    if (!user || !user.user_metadata) return null;
    const name = user.user_metadata[GAMING_NAME_KEY];
    return name ? truncateName(name) : null;
  }

  /**
   * Read cached GOAT name for instant display on reload.
   *
   * @returns {string|null}
   */
  function readCachedGamingName() {
    const name = localStorage.getItem(GAMING_NAME_CACHE_KEY);
    return name ? truncateName(name) : null;
  }

  /**
   * Persist GOAT name locally for signed-in fast bootstrap.
   *
   * @param {string} gamingName In-game name.
   */
  function cacheGamingName(gamingName) {
    const name = truncateName(gamingName);
    if (!name) return;
    localStorage.setItem(GAMING_NAME_CACHE_KEY, name);
  }

  /**
   * Clear cached GOAT name on sign-out.
   */
  function clearCachedGamingName() {
    localStorage.removeItem(GAMING_NAME_CACHE_KEY);
  }

  /**
   * Show loading placeholder while the saved GOAT name is fetched.
   */
  function setGamingNameLoadingPlaceholder() {
    const nameInput = document.getElementById('home-name');
    if (!nameInput || nameInput.value.trim()) return;
    nameInput.placeholder = 'Loading your GOAT name...';
  }

  /**
   * Load gaming name from Supabase Auth profile.
   *
   * @param {object|null} sessionUser User from the current session.
   * @returns {Promise<string|null>}
   */
  async function fetchGamingNameFromAuthProfile(sessionUser) {
    let name = gamingNameFromUserMetadata(sessionUser);
    if (name || !supabaseClient) return name;

    try {
      const { data, error } = await supabaseClient.auth.getUser();
      if (error) {
        console.warn('[auth] getUser failed:', error.message);
        return null;
      }
      return gamingNameFromUserMetadata(data.user);
    } catch (err) {
      console.error('[auth] getUser failed:', err);
      return null;
    }
  }

  /**
   * Fetch the saved gaming name for the current signed-in user.
   *
   * @param {object|null} sessionUser User from the current session.
   * @returns {Promise<string|null>}
   */
  async function fetchSavedGamingName(sessionUser) {
    return fetchGamingNameFromAuthProfile(sessionUser);
  }

  /**
   * Save gaming name to Supabase Auth user metadata.
   *
   * @param {string} gamingName In-game name.
   * @returns {Promise<boolean>}
   */
  async function saveGamingNameToAuthProfile(gamingName) {
    if (!supabaseClient) return false;
    const name = truncateName(gamingName);
    if (!name) return false;
    try {
      const { error } = await supabaseClient.auth.updateUser({
        data: { [GAMING_NAME_KEY]: name },
      });
      if (error) {
        console.warn('[auth] updateUser gaming name failed:', error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.error('[auth] updateUser gaming name failed:', err);
      return false;
    }
  }

  /**
   * Persist gaming name to Supabase Auth user metadata.
   *
   * @param {string} gamingName In-game name.
   * @returns {Promise<void>}
   */
  async function saveGamingName(gamingName) {
    const name = truncateName(gamingName);
    if (!profile.isSignedIn || !profile.userId || !name) return;

    const savedToAuth = await saveGamingNameToAuthProfile(name);
    if (!savedToAuth) {
      console.warn('[auth] could not save gaming name to auth profile');
    } else {
      cacheGamingName(name);
    }
  }

  /**
   * Apply saved or empty gaming name to the home name input.
   *
   * @param {string|null} gamingName Saved gaming name or null for new users.
   */
  function applyGamingNameToInput(gamingName) {
    const nameInput = document.getElementById('home-name');
    if (!nameInput) return;
    nameInput.readOnly = false;
    nameInput.placeholder = profile.isSignedIn ? 'Choose your GOAT name' : 'Enter your GOAT name';
    if (gamingName) {
      nameInput.value = gamingName;
    } else if (!profile.isSignedIn) {
      nameInput.value = '';
    }
  }

  /**
   * Update signed-in / signed-out UI on the home screen.
   */
  function updateAuthUI() {
    const authBottom = document.getElementById('auth-bottom');
    const signedOut = document.getElementById('auth-bottom-signed-out');
    const nameInput = document.getElementById('home-name');

    if (!authBottom) return;

    if (!configured) {
      authBottom.style.display = 'none';
      if (nameInput) {
        nameInput.disabled = false;
        nameInput.readOnly = false;
        nameInput.placeholder = 'Enter your GOAT name';
      }
      updateProfileStatsFab();
      return;
    }

    if (profile.isSignedIn) {
      authBottom.style.display = 'none';
      if (nameInput) {
        nameInput.placeholder = 'Choose your GOAT name';
        nameInput.readOnly = false;
      }
    } else {
      authBottom.style.display = '';
      if (signedOut) signedOut.style.display = '';
      if (nameInput) {
        nameInput.placeholder = 'Enter your GOAT name';
        nameInput.readOnly = false;
      }
      closeProfileStatsDrawer({ immediate: true });
    }

    updateProfileStatsFab();
  }

  /**
   * Render the win/loss ratio bar for a stats mode block.
   *
   * @param {HTMLElement|null} container Bar container element.
   * @param {number} won Matches won.
   * @param {number} lost Matches lost.
   */
  function renderModeStatsBar(container, won, lost) {
    if (!container) return;
    container.innerHTML = '';
    const wins = Number(won) || 0;
    const losses = Number(lost) || 0;
    const total = wins + losses;
    if (total === 0) {
      const empty = document.createElement('span');
      empty.className = 'stats-mode-bar-empty';
      container.appendChild(empty);
      return;
    }
    const winSpan = document.createElement('span');
    winSpan.className = 'stats-mode-bar-win';
    winSpan.style.width = `${(wins / total) * 100}%`;
    const lossSpan = document.createElement('span');
    lossSpan.className = 'stats-mode-bar-loss';
    lossSpan.style.width = `${(losses / total) * 100}%`;
    container.appendChild(winSpan);
    container.appendChild(lossSpan);
  }

  /**
   * Apply won/played/lost values and bar for one stats mode.
   *
   * @param {string} prefix Element id prefix (overall, standard, team).
   * @param {number} played Matches played.
   * @param {number} won Matches won.
   * @param {number} lost Matches lost.
   */
  function applyModeStatsBlock(prefix, played, won, lost) {
    const winEl = document.getElementById(`profile-${prefix}-won`);
    const playedEl = document.getElementById(`profile-${prefix}-played`);
    const lossEl = document.getElementById(`profile-${prefix}-lost`);
    const barEl = document.getElementById(`profile-${prefix}-bar`);
    if (winEl) winEl.textContent = String(won);
    if (playedEl) playedEl.textContent = String(played);
    if (lossEl) lossEl.textContent = String(lost);
    renderModeStatsBar(barEl, won, lost);
  }

  /**
   * Apply profile header fields in the drawer.
   */
  function applyProfileHeaderToDrawer() {
    const avatar = document.getElementById('profile-drawer-avatar');
    const displayNameEl = document.getElementById('profile-display-name');
    const goatNameEl = document.getElementById('profile-goat-name');
    if (!avatar || !displayNameEl || !goatNameEl) return;

    setAvatarImage(avatar, profile.avatarUrl, profile.displayName);
    displayNameEl.textContent = profile.displayName || 'Player';

    const goatName = getGamingNameForPlay();
    if (goatName) {
      goatNameEl.textContent = goatName;
      goatNameEl.classList.remove('is-empty');
    } else {
      goatNameEl.textContent = 'Choose your GOAT name';
      goatNameEl.classList.add('is-empty');
    }
  }

  /**
   * Apply match stats to the profile drawer UI.
   *
   * @param {object|null} stats Stats payload from GET /api/me/stats.
   */
  function applyMatchStatsToDrawer(stats) {
    const played = stats && typeof stats.matchesPlayed === 'number' ? stats.matchesPlayed : 0;
    const won = stats && typeof stats.matchesWon === 'number' ? stats.matchesWon : 0;
    const lost = stats && typeof stats.matchesLost === 'number' ? stats.matchesLost : 0;
    const standard = stats && stats.standard ? stats.standard : { played: 0, won: 0, lost: 0 };
    const team = stats && stats.team ? stats.team : { played: 0, won: 0, lost: 0 };
    const winStreak = stats && typeof stats.winStreak === 'number' ? stats.winStreak : 0;
    const bestWinStreak = stats && typeof stats.bestWinStreak === 'number' ? stats.bestWinStreak : 0;

    const streakEl = document.getElementById('profile-stat-streak');
    const bestStreakEl = document.getElementById('profile-stat-best-streak');
    const streakLine = document.getElementById('profile-streak-line');

    if (streakEl) streakEl.textContent = String(winStreak);
    if (bestStreakEl) bestStreakEl.textContent = String(bestWinStreak);
    if (streakLine) streakLine.classList.toggle('is-active', winStreak > 0);

    applyModeStatsBlock('overall', played, won, lost);
    applyModeStatsBlock('standard', standard.played || 0, standard.won || 0, standard.lost || 0);
    applyModeStatsBlock('team', team.played || 0, team.won || 0, team.lost || 0);
  }

  /**
   * Fetch match stats for the signed-in user.
   *
   * @returns {Promise<object|null>}
   */
  async function fetchMatchStats() {
    const token = await getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch('/api/me/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        console.warn('[auth] fetch match stats failed:', res.status);
        return null;
      }
      return await res.json();
    } catch (err) {
      console.warn('[auth] fetch match stats failed:', err);
      return null;
    }
  }

  /**
   * Expand or collapse the stats panel in the profile drawer.
   *
   * @param {boolean} open Whether the stats body should be visible.
   */
  function setStatsPanelOpen(open) {
    const panel = document.querySelector('#screen-home .stats-panel');
    const toggle = document.getElementById('profile-stats-toggle');
    const body = document.getElementById('profile-stats-body');
    if (!panel || !toggle || !body) return;

    panel.classList.toggle('is-expanded', open);
    toggle.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      body.hidden = false;
    } else {
      body.hidden = true;
    }
  }

  /**
   * Returns true when the profile stats drawer is open or closing.
   *
   * @returns {boolean}
   */
  function isProfileStatsDrawerOpen() {
    const drawer = document.getElementById('profile-stats-drawer');
    return !!(drawer && !drawer.hidden && drawer.classList.contains('is-open'));
  }

  /**
   * Close the profile stats drawer.
   *
   * @param {{ immediate?: boolean }} [options] Skip animation when true.
   */
  function closeProfileStatsDrawer(options) {
    const immediate = !!(options && options.immediate);
    const fab = document.getElementById('profile-stats-fab');
    const backdrop = document.getElementById('profile-stats-backdrop');
    const drawer = document.getElementById('profile-stats-drawer');
    if (!fab || !backdrop || !drawer || drawer.hidden) return;
    if (profileDrawerClosing) return;

    const finishClose = () => {
      profileDrawerClosing = false;
      setStatsPanelOpen(false);
      backdrop.classList.remove('is-open');
      backdrop.hidden = true;
      drawer.classList.remove('is-open');
      drawer.hidden = true;
      backdrop.setAttribute('aria-hidden', 'true');
      fab.setAttribute('aria-expanded', 'false');
    };

    if (immediate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishClose();
      return;
    }

    profileDrawerClosing = true;
    backdrop.classList.remove('is-open');
    drawer.classList.remove('is-open');

    let finished = false;
    const onDone = () => {
      if (finished) return;
      finished = true;
      finishClose();
    };

    drawer.addEventListener('transitionend', (event) => {
      if (event.propertyName === 'transform') onDone();
    }, { once: true });
    window.setTimeout(onDone, PROFILE_DRAWER_MS + 40);
  }

  /**
   * Open the profile stats drawer and load fresh stats.
   *
   * @returns {Promise<void>}
   */
  async function openProfileStatsDrawer() {
    const fab = document.getElementById('profile-stats-fab');
    const backdrop = document.getElementById('profile-stats-backdrop');
    const drawer = document.getElementById('profile-stats-drawer');
    if (!fab || !backdrop || !drawer || !profile.isSignedIn) return;

    if (!drawer.hidden && drawer.classList.contains('is-open')) {
      applyProfileHeaderToDrawer();
      const stats = await fetchMatchStats();
      applyMatchStatsToDrawer(stats);
      return;
    }

    profileDrawerClosing = false;
    applyProfileHeaderToDrawer();
    backdrop.hidden = false;
    drawer.hidden = false;
    backdrop.classList.remove('is-open');
    drawer.classList.remove('is-open');
    backdrop.setAttribute('aria-hidden', 'false');
    fab.setAttribute('aria-expanded', 'true');

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      backdrop.classList.add('is-open');
      drawer.classList.add('is-open');
    } else {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          backdrop.classList.add('is-open');
          drawer.classList.add('is-open');
        });
      });
    }

    const stats = await fetchMatchStats();
    applyMatchStatsToDrawer(stats);
  }

  /**
   * Show or hide the profile avatar button on the home screen.
   */
  function updateProfileStatsFab() {
    const fab = document.getElementById('profile-stats-fab');
    const avatar = document.getElementById('profile-stats-avatar');
    if (!fab || !avatar) return;

    if (!configured || !profile.isSignedIn) {
      fab.hidden = true;
      return;
    }

    fab.hidden = false;
    setAvatarImage(avatar, profile.avatarUrl, profile.displayName);
  }

  /**
   * Bind profile stats drawer interactions once.
   */
  function bindProfileStatsSidebar() {
    if (statsSidebarBound) return;

    const fab = document.getElementById('profile-stats-fab');
    const backdrop = document.getElementById('profile-stats-backdrop');
    const drawer = document.getElementById('profile-stats-drawer');
    const closeBtn = document.getElementById('profile-stats-close');
    const statsToggle = document.getElementById('profile-stats-toggle');
    const statsBody = document.getElementById('profile-stats-body');

    if (!fab || !backdrop || !drawer || !closeBtn || !statsToggle || !statsBody) return;

    statsSidebarBound = true;
    setStatsPanelOpen(false);

    fab.addEventListener('click', () => {
      openProfileStatsDrawer().catch((err) => console.error('[auth] open profile drawer failed:', err));
    });

    backdrop.addEventListener('click', closeProfileStatsDrawer);
    closeBtn.addEventListener('click', closeProfileStatsDrawer);

    statsToggle.addEventListener('click', () => {
      const open = statsBody.hidden;
      setStatsPanelOpen(open);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!isProfileStatsDrawerOpen()) return;
      closeProfileStatsDrawer();
    });
  }

  /**
   * Apply session state immediately (metadata, cache, UI). Does not sync to server.
   *
   * @param {object|null} session Supabase session.
   * @param {string} [event] Supabase auth event name.
   */
  function applySessionFast(session, event) {
    const wasSignedIn = profile.isSignedIn;
    const sessionUser = session && session.user ? session.user : null;
    profile = profileFromUser(sessionUser);
    updateAuthUI();

    if (profile.isSignedIn) {
      let name = gamingNameFromUserMetadata(sessionUser);
      if (!name) name = readCachedGamingName();
      if (name) {
        applyGamingNameToInput(name);
      } else {
        setGamingNameLoadingPlaceholder();
      }
      return;
    }

    if (wasSignedIn) {
      clearCachedGamingName();
      clearCachedAvatarUrl();
      applyGamingNameToInput(null);
      window.dispatchEvent(new CustomEvent('mg-auth-changed', {
        detail: { signedIn: false, event },
      }));
    }
  }

  let enrichInFlight = null;
  let enrichInFlightUserId = '';
  let syncInFlight = null;

  /**
   * Sync user to server and resolve gaming name in the background.
   *
   * @param {object|null} sessionUser User from the current session.
   * @param {string} [event] Supabase auth event name.
   * @returns {Promise<void>}
   */
  async function enrichSession(sessionUser, event) {
    if (!profile.isSignedIn) return;

    if (enrichInFlight && enrichInFlightUserId === profile.userId) {
      return enrichInFlight;
    }

    enrichInFlightUserId = profile.userId;
    enrichInFlight = (async () => {
      const syncResult = await syncUserToServer();
      let savedName = gamingNameFromUserMetadata(sessionUser);
      if (!savedName && syncResult && syncResult.gamingName) {
        savedName = truncateName(syncResult.gamingName);
      }
      if (!savedName) {
        savedName = await fetchSavedGamingName(sessionUser);
      }
      if (!savedName && event === 'SIGNED_IN') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        savedName = await fetchSavedGamingName(sessionUser);
      }

      if (savedName) {
        cacheGamingName(savedName);
        applyGamingNameToInput(savedName);
      } else {
        setGamingNameLoadingPlaceholder();
      }

      const shouldReconnect = event === 'SIGNED_IN';
      window.dispatchEvent(new CustomEvent('mg-auth-changed', {
        detail: { signedIn: true, event, shouldReconnect },
      }));
    })().finally(() => {
      enrichInFlight = null;
      enrichInFlightUserId = '';
    });

    return enrichInFlight;
  }

  /**
   * Perform the server sync request.
   *
   * @returns {Promise<{ gamingName: string|null }|false>}
   */
  async function doSyncUserToServer() {
    const token = await getAccessToken();
    if (!token) return false;
    try {
      const res = await fetch('/api/me/sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn('[auth] sync user failed:', res.status, detail);
        return false;
      }
      const data = await res.json();
      const gamingName = data.gamingName ? truncateName(data.gamingName) : null;
      if (gamingName) cacheGamingName(gamingName);
      return { gamingName };
    } catch (err) {
      console.warn('[auth] sync user failed:', err);
      return false;
    }
  }

  /**
   * Persist the signed-in user to the server database.
   *
   * @returns {Promise<{ gamingName: string|null }|false>}
   */
  async function syncUserToServer() {
    if (syncInFlight) return syncInFlight;
    syncInFlight = doSyncUserToServer().finally(() => {
      syncInFlight = null;
    });
    return syncInFlight;
  }

  /**
   * Refresh profile from the current Supabase session.
   *
   * @param {object|null} session Supabase session.
   * @param {string} [event] Supabase auth event name.
   * @returns {Promise<void>}
   */
  async function applySession(session, event) {
    applySessionFast(session, event);
    if (profile.isSignedIn) {
      const sessionUser = session && session.user ? session.user : null;
      await enrichSession(sessionUser, event);
    }
  }

  /**
   * Mark auth bootstrap complete so the socket can connect.
   */
  function finishAuthBootstrap() {
    if (resolveAuthBootstrapped) {
      resolveAuthBootstrapped();
      resolveAuthBootstrapped = null;
    }
  }

  /**
   * Mark full auth init complete.
   */
  function finishAuthReady() {
    if (resolveAuthReady) {
      resolveAuthReady();
      resolveAuthReady = null;
    }
  }

  /**
   * Initialize Supabase client and session listeners.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    bindProfileStatsSidebar();

    try {
      const res = await fetch('/api/public-config');
      const cfg = await res.json();
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
        configured = false;
        updateAuthUI();
        finishAuthBootstrap();
        finishAuthReady();
        return;
      }
      configured = true;
      supabaseClient = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          detectSessionInUrl: true,
          persistSession: true,
          autoRefreshToken: true,
        },
      });

      supabaseClient.auth.onAuthStateChange((event, session) => {
        applySessionFast(session, event);
        if (profile.isSignedIn) {
          const sessionUser = session && session.user ? session.user : null;
          enrichSession(sessionUser, event).catch((err) => {
            console.error('[auth] session enrichment failed:', err);
          });
        }
      });

      const { data: { session } } = await supabaseClient.auth.getSession();
      applySessionFast(session, 'INIT');
      finishAuthBootstrap();

      const btnGoogle = document.getElementById('btn-google-signin');
      if (btnGoogle) {
        btnGoogle.addEventListener('click', () => {
          signInWithGoogle().catch((err) => console.error('[auth] sign in failed:', err));
        });
      }
      const btnSignOut = document.getElementById('btn-signout');
      if (btnSignOut) {
        btnSignOut.addEventListener('click', () => {
          signOut().catch((err) => console.error('[auth] sign out failed:', err));
        });
      }

      if (profile.isSignedIn) {
        const sessionUser = session && session.user ? session.user : null;
        await enrichSession(sessionUser, 'INIT');
      }
      finishAuthReady();
    } catch (err) {
      console.error('[auth] init failed:', err);
      configured = false;
      updateAuthUI();
      finishAuthBootstrap();
      finishAuthReady();
    }
  }

  /**
   * Start Google OAuth sign-in via Supabase.
   *
   * @returns {Promise<void>}
   */
  async function signInWithGoogle() {
    if (!supabaseClient) return;
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  }

  /**
   * Sign out of Supabase (does not clear room rejoin keys).
   *
   * @returns {Promise<void>}
   */
  async function signOut() {
    if (!supabaseClient) return;
    closeProfileStatsDrawer({ immediate: true });
    const { error } = await supabaseClient.auth.signOut();
    if (error) throw error;
    await applySession(null, 'SIGNED_OUT');
  }

  /**
   * Return the current Supabase access token for Socket.IO auth.
   *
   * @returns {Promise<string|null>}
   */
  async function getAccessToken() {
    if (!supabaseClient) return null;
    const { data: { session } } = await supabaseClient.auth.getSession();
    return session && session.access_token ? session.access_token : null;
  }

  /**
   * Return the current auth profile for UI and gameplay.
   *
   * @returns {{isSignedIn: boolean, userId: string, avatarUrl: string|null, displayName: string}}
   */
  function getAuthProfile() {
    return { ...profile };
  }

  /**
   * Resolve the gaming name from the home name input.
   *
   * @returns {string}
   */
  function getGamingNameForPlay() {
    const nameInput = document.getElementById('home-name');
    return nameInput ? truncateName(nameInput.value) : '';
  }

  /**
   * Returns true when Supabase auth is configured on the server.
   *
   * @returns {boolean}
   */
  function isConfigured() {
    return configured;
  }

  window.MGAuth = {
    init,
    signInWithGoogle,
    signOut,
    getAccessToken,
    getAuthProfile,
    getGamingNameForPlay,
    saveGamingName,
    isConfigured,
  };

  window.MGAuthBootstrapped = new Promise((resolve) => {
    resolveAuthBootstrapped = resolve;
  });
  window.MGAuthReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });

  init();
})();
