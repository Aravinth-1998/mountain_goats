/**
 * Lobby-phase player operations. Timer scheduling itself stays in the socket
 * layer, but bookkeeping — cancelling pending cleanup timers, removing team
 * memberships, reassigning the host — lives here so it can be tested and reused
 * consistently across every remove-path (explicit leave, kick, lobby timeout).
 */

/**
 * Cancel a player's pending 30s lobby-cleanup timer, if any. Safe to call for
 * players who never had one scheduled — used to guarantee that once a player
 * is removed from the room, the timer that was going to remove them later
 * can no longer fire and log a stale "timed out" message.
 *
 * @param {object} player Lobby player state.
 * @param {(handle: unknown) => void} [clearTimer] Timer-clearing function
 *   (defaults to `clearTimeout`). Injectable so tests can use fake timers.
 * @returns {boolean} True when a timer was actually cancelled.
 */
function cancelLobbyCleanup(player, clearTimer = clearTimeout) {
  if (!player || !player._lobbyCleanup) return false;
  clearTimer(player._lobbyCleanup);
  player._lobbyCleanup = null;
  return true;
}

/**
 * Remove a player from a lobby room in a single atomic step: cancel their
 * pending cleanup timer, drop them from `room.players`, purge them from every
 * team's member list, reassign the host if they were the host, and clamp
 * `currentIndex` back into range so a subsequent game start doesn't index off
 * the end of the roster.
 *
 * @param {object} room Room state (must be in lobby, i.e. not started).
 * @param {string} playerId Socket/player id to remove.
 * @param {(handle: unknown) => void} [clearTimer] See {@link cancelLobbyCleanup}.
 * @returns {object|null} The removed player object, or null when not found.
 */
function removePlayerFromLobby(room, playerId, clearTimer = clearTimeout) {
  if (!room || !Array.isArray(room.players)) return null;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return null;

  cancelLobbyCleanup(player, clearTimer);
  room.players = room.players.filter((p) => p.id !== playerId);

  if (Array.isArray(room.teams)) {
    room.teams.forEach((t) => {
      if (Array.isArray(t.members)) {
        t.members = t.members.filter((mid) => mid !== playerId);
      }
    });
  }

  if (room.hostId === playerId) {
    const nextHost = room.players.find((p) => !p.isBot && p.connected);
    room.hostId = nextHost ? nextHost.id : null;
  }

  if (typeof room.currentIndex === 'number' && room.currentIndex >= room.players.length) {
    room.currentIndex = 0;
  }

  return player;
}

module.exports = {
  cancelLobbyCleanup,
  removePlayerFromLobby,
};
