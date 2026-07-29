const standard = require('./standard');
const team = require('./team');

const DEFAULT_MODE_ID = 'standard';

const MODES = {
  [standard.id]: standard,
  [team.id]: team,
};

/**
 * Resolve a mode module by id. Unknown ids fall back to standard.
 *
 * @param {string} modeId Mode identifier.
 * @returns {object} Mode module.
 */
function getMode(modeId) {
  return MODES[modeId] || MODES[DEFAULT_MODE_ID];
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
  return getMode(room.teamMode ? 'team' : 'standard');
}

/**
 * List registered modes.
 *
 * @returns {object[]}
 */
function listModes() {
  return Object.values(MODES);
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
  room.teamMode = next.id === 'team';
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
    id = teamMode ? 'team' : DEFAULT_MODE_ID;
  }
  const mode = getMode(id);
  room.modeId = mode.id;
  room.teamMode = mode.id === 'team';
}

module.exports = {
  DEFAULT_MODE_ID,
  MODES,
  getMode,
  getModeForRoom,
  listModes,
  setRoomMode,
  syncModeFields,
};
