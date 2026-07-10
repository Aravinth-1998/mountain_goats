/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;
  const GAMING_NAME_KEY = 'gaming_name';
  const GAMING_NAME_CACHE_KEY = 'mg_gaming_name';

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
    const signedIn = document.getElementById('auth-bottom-signed-in');
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

    authBottom.style.display = '';

    if (profile.isSignedIn) {
      if (signedOut) signedOut.style.display = 'none';
      if (signedIn) signedIn.style.display = '';
      if (nameInput) {
        nameInput.placeholder = 'Choose your GOAT name';
        nameInput.readOnly = false;
      }
    } else {
      if (signedOut) signedOut.style.display = '';
      if (signedIn) signedIn.style.display = 'none';
      if (nameInput) {
        nameInput.placeholder = 'Enter your GOAT name';
        nameInput.readOnly = false;
      }
      closeProfileStatsDrawer({ immediate: true });
    }

    updateProfileStatsFab();
  }

  /**
   * Set a W/L element to win% / loss% with colored spans.
   *
   * @param {string} elementId Target element id.
   * @param {number} won Matches won.
   * @param {number} played Matches played.
   */
  function setWinLossEl(elementId, won, played) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (!played) {
      el.textContent = '\u2014';
      return;
    }
    const winPct = Math.round((won / played) * 100);
    const lossPct = 100 - winPct;
    el.innerHTML =
      `<span class="stats-wl-win">${winPct}</span>` +
      '/' +
      `<span class="stats-wl-loss">${lossPct}</span>`;
  }

  /**
   * Apply profile header fields in the drawer.
   */
  function applyProfileHeaderToDrawer() {
    const avatar = document.getElementById('profile-drawer-avatar');
    const displayNameEl = document.getElementById('profile-display-name');
    const goatNameEl = document.getElementById('profile-goat-name');
    if (!avatar || !displayNameEl || !goatNameEl) return;

    const avatarUrl = profile.avatarUrl || buildAvatarFallbackUrl(profile.displayName);
    avatar.src = avatarUrl;
    avatar.alt = profile.displayName ? `${profile.displayName} profile photo` : 'Your profile photo';
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
    const standard = stats && stats.standard ? stats.standard : { played: 0, won: 0, lost: 0 };
    const team = stats && stats.team ? stats.team : { played: 0, won: 0, lost: 0 };
    const winStreak = stats && typeof stats.winStreak === 'number' ? stats.winStreak : 0;
    const bestWinStreak = stats && typeof stats.bestWinStreak === 'number' ? stats.bestWinStreak : 0;

    const playedEl = document.getElementById('profile-stat-played');
    const standardPlayedEl = document.getElementById('profile-standard-played');
    const teamPlayedEl = document.getElementById('profile-team-played');
    const streakEl = document.getElementById('profile-stat-streak');
    const bestStreakEl = document.getElementById('profile-stat-best-streak');
    const streakRow = document.getElementById('profile-streak-current-row');

    if (playedEl) playedEl.textContent = String(played);
    if (standardPlayedEl) standardPlayedEl.textContent = String(standard.played || 0);
    if (teamPlayedEl) teamPlayedEl.textContent = String(team.played || 0);
    if (streakEl) streakEl.textContent = String(winStreak);
    if (bestStreakEl) bestStreakEl.textContent = String(bestWinStreak);
    if (streakRow) streakRow.classList.toggle('stats-row-streak-active', winStreak > 0);

    setWinLossEl('profile-stat-wl', won, played);
    setWinLossEl('profile-standard-wl', standard.won || 0, standard.played || 0);
    setWinLossEl('profile-team-wl', team.won || 0, team.played || 0);
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
   * Toggle the Stats accordion open or closed.
   *
   * @param {boolean} open Whether the accordion should be expanded.
   */
  function setStatsAccordionOpen(open) {
    const accordionBtn = document.getElementById('profile-stats-accordion-btn');
    const accordionBody = document.getElementById('profile-stats-accordion-body');
    if (!accordionBtn || !accordionBody) return;

    accordionBtn.classList.toggle('open', open);
    accordionBody.classList.toggle('open', open);
    accordionBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
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
    const avatarUrl = profile.avatarUrl || buildAvatarFallbackUrl(profile.displayName);
    avatar.src = avatarUrl;
    avatar.alt = profile.displayName ? `${profile.displayName} profile photo` : 'Your profile photo';
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
    const accordionBtn = document.getElementById('profile-stats-accordion-btn');
    const accordionBody = document.getElementById('profile-stats-accordion-body');

    if (!fab || !backdrop || !drawer || !closeBtn || !accordionBtn || !accordionBody) return;

    statsSidebarBound = true;

    fab.addEventListener('click', () => {
      openProfileStatsDrawer().catch((err) => console.error('[auth] open profile drawer failed:', err));
    });

    backdrop.addEventListener('click', closeProfileStatsDrawer);
    closeBtn.addEventListener('click', closeProfileStatsDrawer);

    accordionBtn.addEventListener('click', () => {
      const open = !accordionBody.classList.contains('open');
      setStatsAccordionOpen(open);
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
