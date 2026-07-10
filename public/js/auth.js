/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;
  const GAMING_NAME_PREFIX = 'mg_gn_';

  let supabaseClient = null;
  let configured = false;
  let profile = { isSignedIn: false, userId: '' };

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
   * Build localStorage key for a user's cached gaming name.
   *
   * @param {string} userId Supabase user id.
   * @returns {string}
   */
  function gamingNameStorageKey(userId) {
    return GAMING_NAME_PREFIX + userId;
  }

  /**
   * Read a cached gaming name from localStorage.
   *
   * @param {string} userId Supabase user id.
   * @returns {string|null}
   */
  function readCachedGamingName(userId) {
    if (!userId) return null;
    try {
      const cached = localStorage.getItem(gamingNameStorageKey(userId));
      return cached ? truncateName(cached) : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Cache a gaming name in localStorage for this user.
   *
   * @param {string} userId Supabase user id.
   * @param {string} gamingName In-game name.
   */
  function writeCachedGamingName(userId, gamingName) {
    if (!userId || !gamingName) return;
    try {
      localStorage.setItem(gamingNameStorageKey(userId), truncateName(gamingName));
    } catch (_) { /* ignore quota errors */ }
  }

  /**
   * Build profile state from a Supabase session user.
   *
   * @param {object|null} user Supabase user or null when signed out.
   * @returns {{isSignedIn: boolean, userId: string}}
   */
  function profileFromUser(user) {
    if (!user) {
      return { isSignedIn: false, userId: '' };
    }
    return { isSignedIn: true, userId: user.id || '' };
  }

  /**
   * Fetch the saved gaming name for the current signed-in user.
   *
   * @param {string} userId Supabase user id.
   * @returns {Promise<string|null>}
   */
  async function fetchSavedGamingName(userId) {
    const cached = readCachedGamingName(userId);
    const token = await getAccessToken();
    if (!token) return cached;

    try {
      const res = await fetch('/api/me/gaming-name', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.status === 401 || res.status === 503) {
        console.warn('[auth] gaming name fetch failed:', res.status);
        return cached;
      }
      if (!res.ok) return cached;
      const data = await res.json();
      const gamingName = data.gamingName ? truncateName(data.gamingName) : null;
      if (gamingName) writeCachedGamingName(userId, gamingName);
      return gamingName || cached;
    } catch (err) {
      console.error('[auth] fetch gaming name failed:', err);
      return cached;
    }
  }

  /**
   * Persist gaming name via API and local cache.
   *
   * @param {string} gamingName In-game name.
   * @returns {Promise<void>}
   */
  async function saveGamingName(gamingName) {
    const name = truncateName(gamingName);
    if (!profile.isSignedIn || !profile.userId || !name) return;

    writeCachedGamingName(profile.userId, name);

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch('/api/me/gaming-name', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gamingName: name }),
      });
      if (!res.ok) {
        console.warn('[auth] save gaming name failed:', res.status);
      }
    } catch (err) {
      console.error('[auth] save gaming name failed:', err);
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
    }
  }

  /**
   * Refresh profile from the current Supabase session.
   *
   * @param {object|null} session Supabase session.
   * @returns {Promise<void>}
   */
  async function applySession(session) {
    const wasSignedIn = profile.isSignedIn;
    const previousUserId = profile.userId;
    profile = profileFromUser(session && session.user ? session.user : null);
    updateAuthUI();

    if (profile.isSignedIn) {
      const savedName = await fetchSavedGamingName(profile.userId);
      applyGamingNameToInput(savedName);
    } else if (wasSignedIn) {
      applyGamingNameToInput(null);
    } else if (previousUserId !== profile.userId) {
      applyGamingNameToInput(null);
    }

    if (typeof window.MGAuth.onProfileChange === 'function') {
      window.MGAuth.onProfileChange(profile);
    }
  }

  /**
   * Initialize Supabase client and session listeners.
   *
   * @returns {Promise<void>}
   */
  async function init() {
    try {
      const res = await fetch('/api/public-config');
      const cfg = await res.json();
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) {
        configured = false;
        updateAuthUI();
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

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        applySession(session).catch((err) => console.error('[auth] session update failed:', err));
      });

      const { data: { session } } = await supabaseClient.auth.getSession();
      await applySession(session);

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
    } catch (err) {
      console.error('[auth] init failed:', err);
      configured = false;
      updateAuthUI();
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
    await applySession(null);
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
   * @returns {{isSignedIn: boolean, userId: string}}
   */
  function getAuthProfile() {
    return { ...profile };
  }

  /**
   * Resolve the gaming name from the home name input.
   *
   * @returns {string}
   */
  function getDisplayNameForPlay() {
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
    getDisplayNameForPlay,
    saveGamingName,
    isConfigured,
    onProfileChange: null,
  };

  window.MGAuthReady = init();
})();
