/* Mountain Goats - Supabase Google auth (optional) */
(function () {
  const NAME_MAX_LEN = 16;

  let supabaseClient = null;
  let configured = false;
  let profile = { displayName: '', avatarUrl: '', isSignedIn: false };

  /**
   * Truncate a display name to the game name limit.
   *
   * @param {string} raw Raw name string.
   * @returns {string}
   */
  function truncateName(raw) {
    const name = String(raw || '').trim().slice(0, NAME_MAX_LEN);
    return name || 'Player';
  }

  /**
   * Build profile state from a Supabase session user.
   *
   * @param {object|null} user Supabase user or null when signed out.
   * @returns {{displayName: string, avatarUrl: string, isSignedIn: boolean}}
   */
  function profileFromUser(user) {
    if (!user) {
      return { displayName: '', avatarUrl: '', isSignedIn: false };
    }
    const meta = user.user_metadata || {};
    return {
      displayName: truncateName(meta.full_name || meta.name || (user.email ? user.email.split('@')[0] : 'Player')),
      avatarUrl: meta.avatar_url || meta.picture || '',
      isSignedIn: true,
    };
  }

  /**
   * Update signed-in / signed-out UI on the home screen.
   */
  function updateAuthUI() {
    const section = document.getElementById('auth-section');
    const signedOut = document.getElementById('auth-signed-out');
    const signedIn = document.getElementById('auth-signed-in');
    const nameInput = document.getElementById('home-name');
    const avatarEl = document.getElementById('auth-avatar');
    const nameEl = document.getElementById('auth-display-name');

    if (!section) return;

    if (!configured) {
      section.style.display = 'none';
      if (nameInput) {
        nameInput.disabled = false;
        nameInput.readOnly = false;
      }
      return;
    }

    section.style.display = '';

    if (profile.isSignedIn) {
      if (signedOut) signedOut.style.display = 'none';
      if (signedIn) signedIn.style.display = '';
      if (avatarEl) {
        if (profile.avatarUrl) {
          avatarEl.src = profile.avatarUrl;
          avatarEl.style.display = '';
        } else {
          avatarEl.style.display = 'none';
        }
      }
      if (nameEl) nameEl.textContent = profile.displayName;
      if (nameInput) {
        nameInput.value = profile.displayName;
        nameInput.readOnly = true;
        nameInput.classList.add('input-readonly');
      }
    } else {
      if (signedOut) signedOut.style.display = '';
      if (signedIn) signedIn.style.display = 'none';
      if (nameInput) {
        nameInput.readOnly = false;
        nameInput.classList.remove('input-readonly');
      }
    }
  }

  /**
   * Refresh profile from the current Supabase session.
   *
   * @param {object|null} session Supabase session.
   */
  function applySession(session) {
    profile = profileFromUser(session && session.user ? session.user : null);
    updateAuthUI();
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
      applySession(session);

      supabaseClient.auth.onAuthStateChange((_event, session) => {
        applySession(session);
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
    applySession(null);
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
   * @returns {{displayName: string, avatarUrl: string, isSignedIn: boolean}}
   */
  function getAuthProfile() {
    return { ...profile };
  }

  /**
   * Resolve the display name to use for create/join (signed-in or guest input).
   *
   * @returns {string}
   */
  function getDisplayNameForPlay() {
    if (profile.isSignedIn && profile.displayName) {
      return profile.displayName;
    }
    const nameInput = document.getElementById('home-name');
    return nameInput ? String(nameInput.value || '').trim().slice(0, NAME_MAX_LEN) : '';
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
