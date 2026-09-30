'use strict';

/**
 * In-memory room store.
 *
 * Centralises all room and socket-to-room lookups so server.js does not
 * scatter raw object access everywhere.  The socket→room Map gives O(1)
 * findRoomBySocket instead of the earlier O(n) linear scan.
 */

const rooms = {};               // code -> room object
const socketToRoom = new Map(); // socketId -> room code

function genRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000)); // 1000–9999
  } while (rooms[code]);
  return code;
}

module.exports = {
  // ---- Room CRUD ----
  getRoom:   (code) => rooms[code],
  setRoom:   (code, room) => { rooms[code] = room; },
  deleteRoom:(code) => { delete rooms[code]; },
  hasRoom:   (code) => !!rooms[code],
  allRooms:  ()     => Object.values(rooms),
  genRoomCode,

  // ---- Socket → Room mapping ----
  registerSocket:   (socketId, code) => { socketToRoom.set(socketId, code); },
  unregisterSocket: (socketId)       => { socketToRoom.delete(socketId); },
  findRoomBySocket: (socketId) => {
    const code = socketToRoom.get(socketId);
    return code !== undefined ? rooms[code] : undefined;
  },
  swapSocket: (oldId, newId) => {
    const code = socketToRoom.get(oldId);
    if (code !== undefined) {
      socketToRoom.delete(oldId);
      socketToRoom.set(newId, code);
    }
  },
};
