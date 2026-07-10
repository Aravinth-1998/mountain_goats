/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;
  const GAMING_NAME_KEY = 'gaming_name';

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
   * Load and apply the saved gaming name with short retries after sign-in.
   *
   * @param {object|null} sessionUser User from the current session.
   * @param {string} [event] Supabase auth event name.
   * @returns {Promise<string|null>}
   */
  async function loadAndApplyGamingName(sessionUser, event) {
    let savedName = gamingNameFromUserMetadata(sessionUser);
    if (savedName) {
      applyGamingNameToInput(savedName);
    }

    if (!savedName) {
      savedName = await fetchSavedGamingName(sessionUser);
    }

    if (!savedName && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'INIT')) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      savedName = await fetchSavedGamingName(sessionUser);
    }

    applyGamingNameToInput(savedName);
    return savedName;
  }

  /**
   * Persist the signed-in user to the server database.
   *
   * @returns {Promise<void>}
   */
  async function syncUserToServer() {
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
      return true;
    } catch (err) {
      console.warn('[auth] sync user failed:', err);
      return false;
    }
  }

  /**
   * Refresh profile from the current Supabase session.
   *
   * @param {object|null} session Supabase session.
   * @param {string} [event] Supabase auth event name.
   * @returns {Promise<void>}
   */
  async function applySession(session, event) {
    const wasSignedIn = profile.isSignedIn;
    const sessionUser = session && session.user ? session.user : null;
    profile = profileFromUser(sessionUser);
    updateAuthUI();

    if (profile.isSignedIn) {
      await syncUserToServer();
      await loadAndApplyGamingName(sessionUser, event);
      const shouldReconnect = event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'INIT';
      window.dispatchEvent(new CustomEvent('mg-auth-changed', {
        detail: { signedIn: true, event, shouldReconnect },
      }));
    } else if (wasSignedIn) {
      applyGamingNameToInput(null);
      window.dispatchEvent(new CustomEvent('mg-auth-changed', { detail: { signedIn: false, event } }));
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

      supabaseClient.auth.onAuthStateChange((event, session) => {
        applySession(session, event).catch((err) => console.error('[auth] session update failed:', err));
      });

      const { data: { session } } = await supabaseClient.auth.getSession();
      await applySession(session, 'INIT');

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

  window.MGAuthReady = init();
})();
