/**
 * Client game-mode registry (plain script globals, no bundler).
 * Mode files register via GameModes.register(mode).
 */
(function (root) {
  const DEFAULT_MODE_ID = 'standard';
  const LEGACY_TEAM_MODE_ID = 'team';
  const STANDARD_TEAM_MODE_ID = 'standardTeam';
  const modes = Object.create(null);

  /**
   * Normalize mode ids (maps legacy "team" to "standardTeam").
   *
   * @param {string} modeId Raw mode id.
   * @returns {string}
   */
  function normalizeModeId(modeId) {
    if (modeId === LEGACY_TEAM_MODE_ID) return STANDARD_TEAM_MODE_ID;
    return modeId || DEFAULT_MODE_ID;
  }

  /**
   * Resolve mode id from public state (modeId preferred; legacy teamMode fallback).
   *
   * @param {object|null} state Public game state.
   * @returns {string}
   */
  function resolveModeId(state) {
    if (!state) return DEFAULT_MODE_ID;
    if (state.modeId) return normalizeModeId(state.modeId);
    return state.teamMode ? STANDARD_TEAM_MODE_ID : DEFAULT_MODE_ID;
  }

  /**
   * Register a client mode module.
   *
   * @param {object} mode Mode definition with id.
   */
  function register(mode) {
    if (!mode || !mode.id) return;
    modes[mode.id] = mode;
  }

  /**
   * Get a mode by id (falls back to standard).
   *
   * @param {string} modeId Mode id.
   * @returns {object}
   */
  function getMode(modeId) {
    return modes[normalizeModeId(modeId)] || modes[DEFAULT_MODE_ID];
  }

  /**
   * Get the active mode for a room/public state snapshot.
   *
   * @param {object|null} state Public game state.
   * @returns {object}
   */
  function getModeForState(state) {
    return getMode(resolveModeId(state));
  }

  /**
   * List registered modes.
   *
   * @returns {object[]}
   */
  function listModes() {
    return Object.keys(modes).map((id) => modes[id]);
  }

  /**
   * Whether the mode uses team UI / helpers.
   *
   * @param {object} mode Mode module.
   * @returns {boolean}
   */
  function modeUsesTeams(mode) {
    return !!(mode && mode.usesTeams);
  }

  root.GameModes = {
    DEFAULT_MODE_ID,
    LEGACY_TEAM_MODE_ID,
    STANDARD_TEAM_MODE_ID,
    register,
    normalizeModeId,
    getMode,
    getModeForState,
    resolveModeId,
    listModes,
    modeUsesTeams,
    _modes: modes,
  };
})(typeof window !== 'undefined' ? window : globalThis);
