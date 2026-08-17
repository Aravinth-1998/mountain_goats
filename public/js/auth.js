/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;
  const GAMING_NAME_KEY = 'gaming_name';
  const GAMING_NAME_CACHE_KEY = 'mg_gaming_name';
  const AVATAR_URL_CACHE_KEY = 'mg_avatar_url';
  const GUEST_MODE_KEY = 'mg_play_as_guest';

  let supabaseClient = null;
  let configured = false;
  let profile = { isSignedIn: false, userId: '', avatarUrl: null, displayName: '' };
  let statsSidebarBound = false;
  let homeAuthGateBound = false;
  let profileDrawerClosing = false;
  let statsFetchedAt = 0;
  let statsLoadedOnce = false;
  const PROFILE_DRAWER_MS = 280;
  const STATS_REFRESH_MS = 60000;
  let resolveAuthBootstrapped = null;
  let resolveAuthReady = null;

  /**
   * Translate a catalog key (falls back to the key).
   *
   * @param {string} key Dotted catalog key.
   * @param {Record<string, string|number>} [vars] Interpolation values.
   * @returns {string}
   */
  function t(key, vars) {
    return window.t ? window.t(key, vars) : key;
  }

  /**
   * Clone the shared inline loader markup with an optional message.
   *
   * @param {string} [message] Loading text shown below the animation.
   * @returns {HTMLElement|null}
   */
  function createInlineLoader(message) {
    const tpl = document.getElementById('inline-loader-template');
    if (!tpl) return null;
    const node = tpl.content.firstElementChild.cloneNode(true);
    const msg = node.querySelector('.loading-msg');
    if (msg) msg.textContent = message || t('common.loading');
    return node;
  }

  /**
   * Show or hide the stats bars and streak line while loading.
   *
   * @param {boolean} visible Whether stats content should be visible.
   */
  function setProfileStatsContentVisible(visible) {
    const content = document.getElementById('profile-stats-content');
    if (content) content.hidden = !visible;
  }

  /**
   * Show the inline loader in the profile stats drawer.
   *
   * @param {string} [message] Loading text.
   */
  function showProfileStatsLoading(message) {
    const container = document.getElementById('profile-stats-loading');
    if (!container) return;
    container.innerHTML = '';
    const loader = createInlineLoader(message || t('profile.loadingStats'));
    if (loader) container.appendChild(loader);
    container.hidden = false;
    setProfileStatsContentVisible(false);
  }

  /**
   * Hide the inline loader in the profile stats drawer.
   */
  function hideProfileStatsLoading() {
    const container = document.getElementById('profile-stats-loading');
    if (!container) return;
    container.innerHTML = '';
    container.hidden = true;
  }

  /**
   * Show the stats unavailable message in the profile drawer viewport.
   */
  function showProfileStatsUnavailable() {
    const unavailable = document.getElementById('profile-stats-unavailable');
    if (unavailable) {
      unavailable.textContent = t('profile.statsUnavailable');
      unavailable.hidden = false;
    }
    setProfileStatsContentVisible(false);
  }

  /**
   * Hide the stats unavailable message in the profile drawer viewport.
   */
  function hideProfileStatsUnavailable() {
    const unavailable = document.getElementById('profile-stats-unavailable');
    if (unavailable) unavailable.hidden = true;
  }

  /**
   * Fetch profile stats when the stats panel is expanded or stale.
   *
   * @returns {Promise<void>}
   */
  async function fetchStatsIfNeeded() {
    const body = document.getElementById('profile-stats-body');
    if (!body || body.hidden) return;

    const now = Date.now();
    if (statsLoadedOnce && statsFetchedAt && now - statsFetchedAt < STATS_REFRESH_MS) {
      hideProfileStatsUnavailable();
      setProfileStatsContentVisible(true);
      return;
    }

    hideProfileStatsUnavailable();
    showProfileStatsLoading(t('profile.loadingStats'));
    try {
      const result = await fetchMatchStats();
      if (result.ok) {
        applyMatchStatsToDrawer(result.stats);
        statsFetchedAt = Date.now();
        statsLoadedOnce = true;
        setProfileStatsContentVisible(true);
        return;
      }
      if (result.unavailable) {
        showProfileStatsUnavailable();
        return;
      }
      setProfileStatsContentVisible(false);
    } finally {
      hideProfileStatsLoading();
    }
  }

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
    if (!user) return t('common.player');
    const meta = user.user_metadata || {};
    const raw =
      meta.full_name ||
      meta.name ||
      (user.email ? String(user.email).split('@')[0] : '') ||
      t('common.player');
    const name = String(raw).trim();
    return name || t('common.player');
  }

  /**
   * Build a fallback avatar URL when Google photo is unavailable.
   *
   * @param {string} name Display name for initials.
   * @returns {string}
   */
  function buildAvatarFallbackUrl(name) {
    const encoded = encodeURIComponent(name || t('common.player'));
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

    const name = displayName || t('common.player');
    const fallbackUrl = buildAvatarFallbackUrl(name);
    const resolvedPrimary = primaryUrl || readCachedAvatarUrl();
    const usePrimary = resolvedPrimary && resolvedPrimary !== fallbackUrl;

    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.alt = name
      ? t('profile.photoAlt', { name })
      : t('profile.yourPhotoAlt');
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
    nameInput.placeholder = t('home.nameLoading');
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
    nameInput.placeholder = profile.isSignedIn ? t('profile.chooseGoatName') : t('home.namePlaceholder');
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
    const nameInput = document.getElementById('home-name');

    if (!configured) {
      if (nameInput) {
        nameInput.disabled = false;
        nameInput.readOnly = false;
        nameInput.placeholder = t('home.namePlaceholder');
      }
      updateHomeAuthVisibility();
      updateProfileStatsFab();
      return;
    }

    if (profile.isSignedIn) {
      if (nameInput) {
        nameInput.placeholder = t('profile.chooseGoatName');
        nameInput.readOnly = false;
      }
    } else {
      if (nameInput) {
        nameInput.placeholder = t('home.namePlaceholder');
        nameInput.readOnly = false;
      }
      closeProfileStatsDrawer({ immediate: true });
    }

    updateHomeAuthVisibility();
    updateProfileStatsFab();
  }

  /**
   * Whether the user chose Play as Guest this session.
   *
   * @returns {boolean}
   */
  function isGuestMode() {
    try {
      return sessionStorage.getItem(GUEST_MODE_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  /**
   * Persist or clear Play as Guest for this tab session.
   *
   * @param {boolean} on Guest mode enabled.
   * @returns {void}
   */
  function setGuestMode(on) {
    try {
      if (on) sessionStorage.setItem(GUEST_MODE_KEY, '1');
      else sessionStorage.removeItem(GUEST_MODE_KEY);
    } catch (err) {
      /* ignore */
    }
  }

  /**
   * Show Sign in / Guest gate or the name + Create/Join panel.
   *
   * @returns {void}
   */
  function updateHomeAuthVisibility() {
    const gate = document.getElementById('home-auth-gate');
    const panel = document.getElementById('home-play-panel');
    if (!gate || !panel) return;

    if (!configured || profile.isSignedIn || isGuestMode()) {
      gate.hidden = true;
      panel.hidden = false;
      return;
    }

    gate.hidden = false;
    panel.hidden = true;
  }

  /**
   * Bind home Sign in with Google and Play as Guest controls.
   *
   * @returns {void}
   */
  function bindHomeAuthGate() {
    if (homeAuthGateBound) return;
    homeAuthGateBound = true;

    const signInBtn = document.getElementById('btn-sign-in-google');
    if (signInBtn) {
      signInBtn.addEventListener('click', () => {
        signInWithGoogle().catch((err) => console.error('[auth] sign in failed:', err));
      });
    }

    const guestBtn = document.getElementById('btn-play-as-guest');
    if (guestBtn) {
      guestBtn.addEventListener('click', () => {
        setGuestMode(true);
        updateHomeAuthVisibility();
        updateProfileStatsFab();
        const nameInput = document.getElementById('home-name');
        if (nameInput) nameInput.focus();
      });
    }
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
    displayNameEl.textContent = profile.displayName || t('common.player');

    const goatName = getGamingNameForPlay();
    if (goatName) {
      goatNameEl.textContent = goatName;
      goatNameEl.classList.remove('is-empty');
    } else {
      goatNameEl.textContent = t('profile.chooseGoatName');
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
    const standard = (stats && stats.modes && stats.modes.standard)
      || (stats && stats.standard)
      || { played: 0, won: 0, lost: 0 };
    const team = (stats && stats.modes && stats.modes.team)
      || (stats && stats.team)
      || { played: 0, won: 0, lost: 0 };
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
   * @returns {Promise<{ ok: true, stats: object }|{ ok: false, unavailable: true }|{ ok: false, unauthorized: true }>}
   */
  async function fetchMatchStats() {
    const token = await getAccessToken();
    if (!token) return { ok: false, unauthorized: true };
    try {
      const res = await fetch('/api/me/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 503) {
        return { ok: false, unavailable: true };
      }
      if (!res.ok) {
        console.warn('[auth] fetch match stats failed:', res.status);
        return { ok: false, unauthorized: true };
      }
      const stats = await res.json();
      return { ok: true, stats };
    } catch (err) {
      console.warn('[auth] fetch match stats failed:', err);
      return { ok: false, unavailable: true };
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
   * Open the profile stats drawer.
   *
   * @returns {Promise<void>}
   */
  async function openProfileStatsDrawer() {
    const fab = document.getElementById('profile-stats-fab');
    const backdrop = document.getElementById('profile-stats-backdrop');
    const drawer = document.getElementById('profile-stats-drawer');
    if (!fab || !backdrop || !drawer || !profile.isSignedIn) return;

    const alreadyOpen = !drawer.hidden && drawer.classList.contains('is-open');

    if (alreadyOpen) {
      applyProfileHeaderToDrawer();
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

    const body = document.getElementById('profile-stats-body');
    if (body && !body.hidden) {
      await fetchStatsIfNeeded();
    }
  }

  /**
   * Show profile avatar when signed in, or a Google sign-in shortcut for guests.
   */
  function updateProfileStatsFab() {
    const fab = document.getElementById('profile-stats-fab');
    const avatar = document.getElementById('profile-stats-avatar');
    const signInG = document.getElementById('profile-stats-signin-g');
    if (!fab || !avatar || !signInG) return;

    if (!configured) {
      fab.hidden = true;
      avatar.hidden = true;
      signInG.hidden = true;
      signInG.setAttribute('aria-hidden', 'true');
      fab.classList.remove('is-guest');
      return;
    }

    // Guests still need a way back into Google after dismissing the auth gate.
    if (!profile.isSignedIn) {
      fab.hidden = false;
      fab.classList.add('is-guest');
      avatar.hidden = true;
      signInG.hidden = false;
      signInG.setAttribute('aria-hidden', 'false');
      fab.setAttribute('aria-label', t('home.signInAria'));
      // The guest button starts OAuth, it does not open the profile drawer.
      fab.removeAttribute('aria-controls');
      fab.removeAttribute('aria-expanded');
      return;
    }

    fab.hidden = false;
    fab.classList.remove('is-guest');
    avatar.hidden = false;
    signInG.hidden = true;
    signInG.setAttribute('aria-hidden', 'true');
    fab.setAttribute('aria-label', t('profile.yourProfileAria'));
    fab.setAttribute('aria-controls', 'profile-stats-drawer');
    if (!fab.hasAttribute('aria-expanded')) fab.setAttribute('aria-expanded', 'false');
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
      if (profile.isSignedIn) {
        openProfileStatsDrawer().catch((err) => console.error('[auth] open profile drawer failed:', err));
        return;
      }
      signInWithGoogle().catch((err) => console.error('[auth] sign in failed:', err));
    });

    backdrop.addEventListener('click', closeProfileStatsDrawer);
    closeBtn.addEventListener('click', closeProfileStatsDrawer);

    statsToggle.addEventListener('click', () => {
      const open = statsBody.hidden;
      setStatsPanelOpen(open);
      if (open) {
        const now = Date.now();
        const isFresh = statsLoadedOnce && statsFetchedAt && now - statsFetchedAt < STATS_REFRESH_MS;
        if (!isFresh) {
          setProfileStatsContentVisible(false);
        }
        fetchStatsIfNeeded().catch((err) => console.error('[auth] fetch stats failed:', err));
      }
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
      setGuestMode(false);
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

  /* ── Venom Games Auth Hub ──────────────────────────────────────────
   * A hidden <iframe> served from /auth-hub.html on Flip7's domain acts as
   * a shared session store.  Any game that embeds the same URL can read
   * and write sessions via postMessage, enabling automatic cross-game
   * sign-in without touching the other game's codebase.
   * ─────────────────────────────────────────────────────────────────── */
  const HUB_SRC    = '/auth-hub.html';
  const HUB_ORIGIN = window.location.origin;   // hub is same-origin as MG
  const HUB_READY_MS = 3000;
  const HUB_MSG_MS   = 2000;

  let _hubFrame  = null;
  let _hubReady  = false;

  /** Inject the hub iframe and wait for VG_HUB_READY (or timeout). */
  function _initHub() {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.src = HUB_SRC;
      frame.setAttribute('aria-hidden', 'true');
      frame.setAttribute('tabindex', '-1');
      frame.setAttribute('allow', 'storage-access');   // needed for Chrome storage partitioning bypass
      frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
      document.body.appendChild(frame);
      _hubFrame = frame;

      const timer = setTimeout(() => {
        console.warn('[auth] hub ready timeout');
        resolve(false);
      }, HUB_READY_MS);

      function onReady(e) {
        if (e.source !== frame.contentWindow) return;
        if (!e.data || e.data.type !== 'VG_HUB_READY') return;
        clearTimeout(timer);
        window.removeEventListener('message', onReady);
        _hubReady = true;
        resolve(true);
      }
      window.addEventListener('message', onReady);
    });
  }

  /** Send one message to the hub and wait for its reply. */
  function _hubMsg(msg, replyType) {
    return new Promise((resolve) => {
      if (!_hubReady || !_hubFrame || !_hubFrame.contentWindow) { resolve(null); return; }

      const timer = setTimeout(() => {
        window.removeEventListener('message', onReply);
        resolve(null);
      }, HUB_MSG_MS);

      function onReply(e) {
        if (e.source !== _hubFrame.contentWindow) return;
        if (!e.data || e.data.type !== replyType) return;
        clearTimeout(timer);
        window.removeEventListener('message', onReply);
        resolve(e.data);
      }
      window.addEventListener('message', onReply);
      _hubFrame.contentWindow.postMessage(msg, HUB_ORIGIN);
    });
  }

  async function _hubGetSession() {
    const r = await _hubMsg({ type: 'VG_GET_SESSION' }, 'VG_SESSION_RESULT');
    return (r && r.session) ? r.session : null;
  }

  function _hubSetSession(session) {
    if (!session || !session.access_token || !session.refresh_token) return;
    _hubMsg({ type: 'VG_SET_SESSION', session }, 'VG_SESSION_SET');
  }

  function _hubClearSession() {
    _hubMsg({ type: 'VG_CLEAR_SESSION' }, 'VG_SESSION_CLEARED');
  }

  /* ── Cross-game first-party session store ──────────────────────────
   * Chrome storage partitioning prevents the hub iframe from sharing
   * localStorage across origins.  Instead, each game writes its own
   * session to its first-party localStorage under vg_shared_session.
   * cross-auth.html reads this (unpartitioned) and passes tokens back
   * via a redirect URL hash — the same pattern Supabase uses for OAuth.
   * ─────────────────────────────────────────────────────────────────── */
  function _saveCrossAuthSession(session) {
    if (!session || !session.access_token || !session.refresh_token) return;
    try {
      localStorage.setItem('vg_shared_session', JSON.stringify({
        access_token:  session.access_token,
        refresh_token: session.refresh_token,
        saved_at:      Date.now(),
      }));
    } catch (e) {}
  }

  function _clearCrossAuthSession() {
    try { localStorage.removeItem('vg_shared_session'); } catch (e) {}
  }

  /**
   * Initialize Supabase client and session listeners.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    bindProfileStatsSidebar();
    bindHomeAuthGate();

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
        // Keep hub + first-party store in sync
        if (event === 'SIGNED_IN' && session) {
          _hubSetSession(session);
          _saveCrossAuthSession(session);
        } else if (event === 'TOKEN_REFRESHED' && session) {
          _hubSetSession(session);
          _saveCrossAuthSession(session);
        } else if (event === 'SIGNED_OUT') {
          _hubClearSession();
          _clearCrossAuthSession();
        }
        if (profile.isSignedIn) {
          const sessionUser = session && session.user ? session.user : null;
          enrichSession(sessionUser, event).catch((err) => {
            console.error('[auth] session enrichment failed:', err);
          });
        }
      });

      // ── Cross-game bridge: read tokens passed via redirect from F7 ──
      const _vgHash = new URLSearchParams(window.location.hash.slice(1));
      const _vgAt   = _vgHash.get('vg_at');
      const _vgRt   = _vgHash.get('vg_rt');
      if (_vgAt && _vgRt) {
        // Remove tokens from URL so they don't linger in browser history
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      // Start the hub iframe — wait for it before syncing sessions
      await _initHub();

      // Sync session: bridge redirect > local session > cross-auth redirect
      try {
        const { data: { session: localSession } } = await supabaseClient.auth.getSession();
        if (_vgAt && _vgRt && !localSession) {
          // Incoming cross-game bridge — apply tokens from F7's redirect
          console.log('[auth] importing session from cross-game bridge');
          await supabaseClient.auth.setSession({ access_token: _vgAt, refresh_token: _vgRt });
        } else if (localSession) {
          _hubSetSession(localSession);
          _saveCrossAuthSession(localSession);
        } else {
          // No local session — redirect to F7's cross-auth.html (once per page session)
          if (!sessionStorage.getItem('vg_bridge_tried')) {
            sessionStorage.setItem('vg_bridge_tried', '1');
            const _isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            const _crossBase = _isLocal ? 'http://localhost:3003' : 'https://flip7-6eif.onrender.com';
            finishAuthBootstrap();
            finishAuthReady();
            window.location.replace(_crossBase + '/cross-auth.html?redirect_to=' + encodeURIComponent(window.location.href));
            return;
          }
        }
      } catch (syncErr) {
        console.warn('[auth] session sync failed:', syncErr.message);
      }

      const { data: { session } } = await supabaseClient.auth.getSession();
      applySessionFast(session, 'INIT');
      finishAuthBootstrap();

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
    statsFetchedAt = 0;
    statsLoadedOnce = false;
    setProfileStatsContentVisible(false);
    hideProfileStatsUnavailable();
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

  window.MGUi = Object.assign(window.MGUi || {}, {
    createInlineLoader,
  });

  window.MGAuthBootstrapped = new Promise((resolve) => {
    resolveAuthBootstrapped = resolve;
  });
  window.MGAuthReady = new Promise((resolve) => {
    resolveAuthReady = resolve;
  });

  init();
})();
