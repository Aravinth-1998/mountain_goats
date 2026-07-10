/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;

  let supabaseClient = null;
  let configured = false;
  let profile = { isSignedIn: false };

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
   * @returns {{isSignedIn: boolean}}
   */
  function profileFromUser(user) {
    return { isSignedIn: !!user };
  }

  /**
   * Fetch the saved gaming name for the current signed-in user.
   *
   * @returns {Promise<string|null>}
   */
  async function fetchSavedGamingName() {
    const token = await getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch('/api/me/gaming-name', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.gamingName ? truncateName(data.gamingName) : null;
    } catch (err) {
      console.error('[auth] fetch gaming name failed:', err);
      return null;
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
    nameInput.value = gamingName || '';
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
    profile = profileFromUser(session && session.user ? session.user : null);
    updateAuthUI();

    if (profile.isSignedIn) {
      const savedName = await fetchSavedGamingName();
      applyGamingNameToInput(savedName);
    } else if (wasSignedIn) {
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

      const { data: { session } } = await supabaseClient.auth.getSession();
      await applySession(session);

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        applySession(session).catch((err) => console.error('[auth] session update failed:', err));
      });

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
   * @returns {{isSignedIn: boolean}}
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
    isConfigured,
    onProfileChange: null,
  };

  window.MGAuthReady = init();
})();
