const standard = require('./standard');
const standardTeam = require('./standardTeam');

const DEFAULT_MODE_ID = 'standard';

/** Legacy id used before standardTeam rename. */
const LEGACY_TEAM_MODE_ID = 'team';

const MODES = {
  [standard.id]: standard,
  [standardTeam.id]: standardTeam,
};

/**
 * Normalize mode ids (maps legacy "team" to "standardTeam").
 *
 * @param {string} modeId Raw mode id.
 * @returns {string}
 */
function normalizeModeId(modeId) {
  if (modeId === LEGACY_TEAM_MODE_ID) return standardTeam.id;
  return modeId || DEFAULT_MODE_ID;
}

/**
 * Resolve a mode module by id. Unknown ids fall back to standard.
 *
 * @param {string} modeId Mode identifier.
 * @returns {object} Mode module.
 */
function getMode(modeId) {
  return MODES[normalizeModeId(modeId)] || MODES[DEFAULT_MODE_ID];
}

/**
 * Resolve the active mode for a room (supports legacy teamMode-only rooms).
 *
 * @param {object} room Room object.
 * @returns {object} Mode module.
 */
function getModeForRoom(room) {
  if (!room) return getMode(DEFAULT_MODE_ID);
  if (room.modeId) return getMode(room.modeId);
  return getMode(room.teamMode ? standardTeam.id : 'standard');
}

/**
 * List registered modes (excludes legacy aliases).
 *
 * @returns {object[]}
 */
function listModes() {
  return Object.values(MODES);
}

/**
 * Whether a mode uses team helpers / teamMode derived flag.
 *
 * @param {object} mode Mode module.
 * @returns {boolean}
 */
function modeUsesTeams(mode) {
  return !!(mode && mode.usesTeams);
}

/**
 * Set room.modeId and derived teamMode, running clear/set lobby hooks.
 *
 * @param {object} room Active room.
 * @param {string} modeId Target mode id.
 * @param {function} [log] Log callback.
 */
function setRoomMode(room, modeId, log = () => {}) {
  const next = getMode(modeId);
  const prev = getModeForRoom(room);
  if (prev.id !== next.id) {
    prev.onClearMode(room, log);
  }
  room.modeId = next.id;
  room.teamMode = modeUsesTeams(next);
  if (prev.id !== next.id) {
    next.onSetMode(room, log);
  }
}

/**
 * Ensure modeId and teamMode stay in sync on a room.
 *
 * @param {object} room Room object.
 * @param {string} [modeId] Preferred mode id.
 * @param {boolean} [teamMode] Legacy flag used when modeId is absent.
 */
function syncModeFields(room, modeId, teamMode) {
  let id = modeId;
  if (!id) {
    id = teamMode ? standardTeam.id : DEFAULT_MODE_ID;
  }
  const mode = getMode(id);
  room.modeId = mode.id;
  room.teamMode = modeUsesTeams(mode);
}

module.exports = {
  DEFAULT_MODE_ID,
  LEGACY_TEAM_MODE_ID,
  MODES,
  normalizeModeId,
  getMode,
  getModeForRoom,
  listModes,
  modeUsesTeams,
  setRoomMode,
  syncModeFields,
};
