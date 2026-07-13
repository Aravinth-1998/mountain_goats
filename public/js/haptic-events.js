/**
 * Derive haptic feedback events by diffing consecutive game states.
 * Pure logic with no DOM dependencies (testable in Node).
 */

/**
 * @param {Array<{t: number, text: string}>|undefined} log
 * @returns {number}
 */
function maxLogTime(log) {
  if (!log || !log.length) return 0;
  return Math.max(...log.map((entry) => entry.t || 0));
}

/**
 * @param {string} name
 * @param {Array<{id: string, name: string}>|undefined} players
 * @returns {string|null}
 */
function playerIdByName(name, players) {
  if (!name || !players) return null;
  const match = players.find((player) => player.name === name);
  return match ? match.id : null;
}

/**
 * @param {string} text
 * @param {Array<{id: string, name: string}>|undefined} players
 * @param {string|null} myId
 * @returns {{type: string, actorId?: string|null, victimId?: string|null, self: boolean}|null}
 */
function parseLogEntry(text, players, myId) {
  if (!text) return null;

  let match = text.match(/^(.+?) rolled /);
  if (match) {
    const actorId = playerIdByName(match[1], players);
    return { type: 'dice_roll', actorId, self: actorId === myId };
  }

  match = text.match(/^(.+?) re-faced dice/);
  if (match) {
    const actorId = playerIdByName(match[1], players);
    return { type: 'dice_adjust', actorId, self: actorId === myId };
  }

  match = text.match(/^(.+?)'s goat was bumped off/);
  if (match) {
    const victimId = playerIdByName(match[1], players);
    return { type: 'bump', victimId, self: victimId === myId };
  }

  match = text.match(/^(.+?)'s goat was wiped off/);
  if (match) {
    const victimId = playerIdByName(match[1], players);
    return { type: 'bump', victimId, self: victimId === myId };
  }

  if (text.includes('reached the top') || text.includes('harvested a') || text.includes('joined teammate')) {
    match = text.match(/^(.+?) (?:reached the top|harvested a|joined teammate)/);
    const actorId = match ? playerIdByName(match[1], players) : null;
    return { type: 'summit', actorId, self: actorId === myId };
  }

  match = text.match(/^(.+?) completed a full set/);
  if (match) {
    const actorId = playerIdByName(match[1], players);
    return { type: 'bonus', actorId, self: actorId === myId };
  }

  if (text.includes('Final round!')) {
    return { type: 'final_round', self: false };
  }

  if (text.includes('The climb begins!')) {
    return { type: 'game_start', self: false };
  }

  if (text.includes('Game over!')) {
    return { type: 'game_end', self: false };
  }

  return null;
}

/**
 * Compare previous and next public game state and return haptic events for new actions.
 *
 * @param {object|null} prev Previous state snapshot.
 * @param {object|null} next Next state snapshot.
 * @param {string|null} myId Local player id.
 * @returns {Array<{type: string, actorId?: string|null, victimId?: string|null, self: boolean}>}
 */
function deriveHapticEvents(prev, next, myId) {
  if (!prev || !next) return [];

  const events = [];
  const prevMaxT = maxLogTime(prev.log);
  const newEntries = (next.log || []).filter((entry) => (entry.t || 0) > prevMaxT);

  for (const entry of newEntries) {
    const event = parseLogEntry(entry.text, next.players, myId);
    if (event) events.push(event);
  }

  const hasLogType = (type) => events.some((event) => event.type === type);

  if (!hasLogType('dice_roll') && !prev.rolled && next.rolled) {
    const actorId = next.currentPlayerId || null;
    events.push({ type: 'dice_roll', actorId, self: actorId === myId });
  }

  if (prev.currentPlayerId !== next.currentPlayerId && next.currentPlayerId === myId) {
    events.push({ type: 'your_turn', self: true });
  }

  if (!hasLogType('final_round') && !prev.lastRound && next.lastRound) {
    events.push({ type: 'final_round', self: false });
  }

  if (!hasLogType('game_end') && !prev.finished && next.finished) {
    events.push({ type: 'game_end', self: false });
  }

  return events;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { deriveHapticEvents, parseLogEntry, maxLogTime, playerIdByName };
}

if (typeof window !== 'undefined') {
  window.deriveHapticEvents = deriveHapticEvents;
}
