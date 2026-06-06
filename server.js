/**
 * Mountain Goats - online multiplayer dice game (Reiner Knizia).
 * Backend: Express + Socket.IO. Serves the static client from /public.
 *
 * RULES (per https://www.yucata.de/en/Rules/MountainGoats):
 *  - 6 mountains numbered 5-10. Heights (spaces): 5,6 -> 4; 7,8 -> 3; 9,10 -> 2.
 *  - Each mountain has a stack of Point Tokens worth its number.
 *      Full (4p): 12,11,10,9,8,7.  3p: -1 each.  2p: -2 each.
 *  - 4 Bonus Tokens: 15, 12, 9, 6 (claimed highest-first).
 *  - Each player has one goat at the foot of each mountain (6 goats).
 *  - A turn: roll 4 dice. If >1 "one" was rolled, all but one of the 1s may be
 *    set to any face. Split the dice into groups; each group whose SUM is 5-10
 *    moves that mountain's goat up one space.
 *  - Reaching the TOP takes a Point Token and bumps any goat already there back
 *    to the foot (top is single-occupancy). A group matching a mountain whose
 *    goat is already on top instead harvests another Point Token.
 *  - Collecting a token from all 6 mountains (a full set) claims the highest
 *    remaining Bonus Token; further sets claim further Bonus Tokens.
 *  - End: when all Bonus Tokens are claimed OR 3 mountains are emptied, finish so
 *    every player has had equal turns. Most points wins; ties: most goats on
 *    tops, then a goat on the higher-numbered mountain.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// Game configuration
// ----------------------------------------------------------------------------
const MOUNTAIN_DEFS = [
  { value: 5, height: 4, fullStack: 12, color: '#4a8f3c' },
  { value: 6, height: 4, fullStack: 11, color: '#c9772f' },
  { value: 7, height: 3, fullStack: 10, color: '#9c4f3a' },
  { value: 8, height: 3, fullStack: 9, color: '#6b7280' },
  { value: 9, height: 2, fullStack: 8, color: '#3f7fa6' },
  { value: 10, height: 2, fullStack: 7, color: '#aab8c9' },
];
const BONUS_DEFS = [15, 12, 9, 6];
const NUM_DICE = 4;
const MAX_PLAYERS = 6;
const PLAYER_COLORS = ['#e63946', '#2a9d8f', '#f4a261', '#8e7dff', '#ffd166', '#06d6a0'];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function buildMountains(numPlayers) {
  const removal = Math.max(0, 4 - numPlayers); // 2p:-2, 3p:-1, 4p+:0
  return MOUNTAIN_DEFS.map((m) => ({
    value: m.value,
    height: m.height,
    color: m.color,
    fullStack: m.fullStack,
    chips: Math.max(0, m.fullStack - removal),
  }));
}

function pointsOf(room, player) {
  let s = 0;
  room.mountains.forEach((m, i) => {
    s += m.value * (player.collected[i] || 0);
  });
  return s;
}

function bonusOf(player) {
  return player.bonus.reduce((a, v) => a + v, 0);
}

function scoreOf(room, player) {
  return pointsOf(room, player) + bonusOf(player);
}

// Goats currently standing on a mountain TOP (pos === height).
function topsOf(room, player) {
  let n = 0;
  room.mountains.forEach((m, i) => {
    if (player.pos[i] >= m.height) n++;
  });
  return n;
}

function highestTopValue(room, player) {
  let v = 0;
  room.mountains.forEach((m, i) => {
    if (player.pos[i] >= m.height && m.value > v) v = m.value;
  });
  return v;
}

// Number of complete sets collected = the smallest per-mountain token count.
function setsOf(player) {
  return player.collected.reduce((min, c) => Math.min(min, c), Infinity);
}

function emptyMountainCount(room) {
  return room.mountains.reduce((a, m) => a + (m.chips <= 0 ? 1 : 0), 0);
}

function genRoomCode() {
  let code = '';
  do {
    code = String(Math.floor(1000 + Math.random() * 9000)); // 1000–9999
  } while (rooms[code]);
  return code;
}

// ----------------------------------------------------------------------------
// Room state
// ----------------------------------------------------------------------------
const rooms = {}; // code -> room

function createRoom() {
  const code = genRoomCode();
  const room = {
    code,
    hostId: null,
    players: [],
    mountains: buildMountains(4), // placeholder until the game starts
    bonusTokens: [...BONUS_DEFS], // remaining bonus tokens (highest first)
    lastRound: false,
    started: false,
    finished: false,
    winnerId: null,
    currentIndex: 0,
    dice: null, // [d1..d4]
    diceUsed: [], // booleans per die
    adjustable: [], // die indices the player may re-face (extra 1s)
    rolled: false,
    log: [],
    botTimer: null,
    watchdog: null,
  };
  rooms[code] = room;
  return room;
}

function addPlayer(room, socketId, name, isBot = false) {
  const color = PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
  const player = {
    id: socketId,
    name,
    color,
    isBot,
    pos: MOUNTAIN_DEFS.map(() => 0), // goat position per mountain (0 = foot)
    collected: MOUNTAIN_DEFS.map(() => 0), // Point Tokens collected per mountain
    bonus: [], // Bonus Token values claimed
    turns: 0,
    connected: true,
  };
  room.players.push(player);
  if (!room.hostId && !isBot) room.hostId = socketId;
  return player;
}

function addBot(room) {
  let k = 1;
  const used = new Set(room.players.map((p) => p.name));
  while (used.has('Bot ' + k)) k++;
  const id = 'bot_' + Math.random().toString(36).slice(2, 9);
  return addPlayer(room, id, 'Bot ' + k, true);
}

function hasHuman(room) {
  return room.players.some((p) => !p.isBot && p.connected);
}

function resetForNewGame(room) {
  const count = room.players.filter((p) => p.connected).length || room.players.length;
  room.mountains = buildMountains(count);
  room.bonusTokens = [...BONUS_DEFS];
  room.lastRound = false;
  room.endReason = null;
  room.finished = false;
  room.winnerId = null;
  room.currentIndex = 0;
  room.dice = null;
  room.diceUsed = [];
  room.adjustable = [];
  room.rolled = false;
  room.players.forEach((p) => {
    p.pos = room.mountains.map(() => 0);
    p.collected = room.mountains.map(() => 0);
    p.bonus = [];
    p.turns = 0;
  });
}

function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    started: room.started,
    finished: room.finished,
    winnerId: room.winnerId,
    emptyMountains: emptyMountainCount(room),
    lastRound: room.lastRound,
    endReason: room.endReason || null,
    bonusTokens: room.bonusTokens,
    numDice: NUM_DICE,
    currentIndex: room.currentIndex,
    currentPlayerId: room.players[room.currentIndex] ? room.players[room.currentIndex].id : null,
    dice: room.dice,
    diceUsed: room.diceUsed,
    adjustable: room.adjustable,
    rolled: room.rolled,
    mountains: room.mountains, // {value, height, color, fullStack, chips}
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isBot: !!p.isBot,
      pos: p.pos,
      collected: p.collected,
      points: pointsOf(room, p),
      bonus: p.bonus,
      bonusPoints: bonusOf(p),
      score: scoreOf(room, p),
      tops: topsOf(room, p),
      sets: Math.max(0, setsOf(p)),
      connected: p.connected,
    })),
    log: room.log.slice(-14),
  };
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
}

function pushLog(room, text) {
  room.log.push({ t: Date.now(), text });
}

function advanceTurn(room) {
  if (room.players.length === 0) return;
  const finishing = room.players[room.currentIndex];
  if (finishing) finishing.turns = (finishing.turns || 0) + 1;

  room.rolled = false;
  room.dice = null;
  room.diceUsed = [];
  room.adjustable = [];
  let next = room.currentIndex;
  for (let i = 0; i < room.players.length; i++) {
    next = (next + 1) % room.players.length;
    if (room.players[next].connected || room.players[next].isBot) break;
    // disconnected non-bot: still valid (bot will substitute)
    break;
  }
  room.currentIndex = next;

  // Endgame: once triggered, finish when every connected player has equal turns.
  if (room.lastRound && !room.finished) {
    const counts = room.players.filter((p) => p.connected).map((p) => p.turns || 0);
    if (counts.length && Math.max(...counts) === Math.min(...counts)) {
      endGame(room);
    }
  }

  // Always schedule the next bot turn from inside advanceTurn —
  // this guarantees no turn is ever silently dropped regardless of call site.
  if (!room.finished) {
    setImmediate(() => {
      if (!room.finished && shouldBotPlay(room) && !room.botTimer) {
        scheduleBot(room);
      }
    });
  }
}

function findRoomBySocket(socketId) {
  for (const code in rooms) {
    const room = rooms[code];
    if (room.players.some((p) => p.id === socketId)) return room;
  }
  return null;
}

function checkEndgameTrigger(room) {
  if (room.lastRound) return;
  const allBonus = room.bonusTokens.length === 0;
  if (allBonus || emptyMountainCount(room) >= 3) {
    room.lastRound = true;
    room.endReason = allBonus ? 'bonus' : 'empty';
    const reason = allBonus ? 'all Bonus Tokens claimed' : '3 mountains emptied';
    pushLog(room, `Final round! (${reason}) - everyone gets equal turns. 🔔`);
  }
}

// Award Bonus Tokens for any newly completed full sets.
function awardBonus(room, player) {
  const sets = Math.max(0, setsOf(player));
  while (player.bonus.length < sets && room.bonusTokens.length > 0) {
    const v = room.bonusTokens.shift();
    player.bonus.push(v);
    pushLog(room, `${player.name} completed a full set and claimed the ${v}p Bonus Token! ✨`);
  }
}

// Take a Point Token from a mountain for the player (and check sets / endgame).
function takeToken(room, player, i) {
  const m = room.mountains[i];
  if (m.chips <= 0) return;
  m.chips -= 1;
  player.collected[i] += 1;
  awardBonus(room, player);
  checkEndgameTrigger(room);
}

// Apply one upward step (a dice group) on mountain i for the player.
function applyClimb(room, player, i) {
  const m = room.mountains[i];
  if (player.pos[i] >= m.height) {
    // Already on top: harvest another token instead of moving.
    if (m.chips > 0) {
      takeToken(room, player, i);
      pushLog(room, `${player.name} harvested a ${m.value}p token from Mountain ${m.value}.`);
    }
    return;
  }
  player.pos[i] += 1;
  if (player.pos[i] >= m.height) {
    // Reached the top: bump any other goat already there to the foot.
    room.players.forEach((o) => {
      if (o.id !== player.id && o.pos[i] >= m.height) {
        o.pos[i] = 0;
        pushLog(room, `${o.name}'s goat was bumped off the top of Mountain ${m.value}!`);
      }
    });
    if (m.chips > 0) {
      takeToken(room, player, i);
      pushLog(room, `${player.name} reached the top of Mountain ${m.value} (+${m.value}).`);
    } else {
      pushLog(room, `${player.name} reached the top of Mountain ${m.value} (no tokens left).`);
    }
  }
}

function rankedPlayers(room) {
  return room.players
    .map((p) => ({
      p,
      score: scoreOf(room, p),
      tops: topsOf(room, p),
      highTop: highestTopValue(room, p),
    }))
    .sort((a, b) => b.score - a.score || b.tops - a.tops || b.highTop - a.highTop);
}

function endGame(room) {
  room.finished = true;
  if (room.watchdog) { clearInterval(room.watchdog); room.watchdog = null; }
  const ranked = rankedPlayers(room);
  const winner = ranked[0] ? ranked[0].p : null;
  room.winnerId = winner ? winner.id : null;
  if (winner) pushLog(room, `Game over! ${winner.name} wins with ${ranked[0].score} points! 🏆`);
}

// Watchdog: every 8s, if it's a bot/disconnected turn and no timer is running, kick it.
function startWatchdog(room) {
  if (room.watchdog) clearInterval(room.watchdog);
  room.watchdog = setInterval(() => {
    if (!rooms[room.code] || room.finished || !room.started) {
      clearInterval(room.watchdog);
      room.watchdog = null;
      return;
    }
    if (shouldBotPlay(room) && !room.botTimer && hasHuman(room)) {
      console.warn(`[watchdog] room ${room.code}: bot turn stuck, kicking.`);
      botAct(room);
    }
  }, 8000);
}

// ----------------------------------------------------------------------------
// Bot AI
// ----------------------------------------------------------------------------
// Score a single possible group (indices + target mountain) for the bot.
function scoreGroup(room, bot, indices, mi) {
  const m = room.mountains[mi];
  const pos = bot.pos[mi];
  const atTop = pos >= m.height;
  const stepsLeft = m.height - pos;

  // Simulate collecting a token and check if that yields a new set.
  const currentSets = bot.collected.reduce((mn, c) => Math.min(mn, c), Infinity);
  const newCollected = bot.collected.map((c, i) => (i === mi ? c + 1 : c));
  const newSets = newCollected.reduce((mn, c) => Math.min(mn, c), Infinity);
  const bonusValue = newSets > currentSets && room.bonusTokens.length > 0
    ? room.bonusTokens[0]  // the highest remaining bonus token
    : 0;

  // Count opponents on this top (bumping them is valuable).
  const oppsOnTop = room.players.filter(
    (o) => o.id !== bot.id && o.pos[mi] >= m.height
  ).length;

  let value;

  if (m.chips <= 0) {
    // Empty mountain: only useful if we can bump someone off the top.
    if (!atTop && stepsLeft === 1 && oppsOnTop > 0) {
      value = 2 * oppsOnTop; // mild reward
    } else {
      return -Infinity; // waste of dice
    }
  } else if (atTop) {
    // Already on top: harvest another token.
    value = m.value + bonusValue;
    // Slightly prefer mountains where chips are scarce (closing soon).
    value += Math.max(0, 3 - m.chips);
  } else if (stepsLeft === 1) {
    // This move reaches the top → collect a token + optional bump + optional set.
    value = m.value + 4 + bonusValue + oppsOnTop * 3;
    // Urgency: fewer chips left = close it before someone else does.
    value += Math.max(0, 4 - m.chips) * 1.5;
  } else {
    // Intermediate step — progress value, weighted by mountain value and urgency.
    const progressFactor = 1 / stepsLeft; // closer to top = more valuable
    value = m.value * 0.4 * progressFactor;
    // Chips running low means competition is heating up for this mountain.
    if (m.chips <= 3) value += 1.5;
  }

  // Penalty for using more dice in one group — leaves fewer dice for other moves.
  value -= (indices.length - 1) * 0.8;

  return value;
}

// Enumerate all subsets of unused dice, evaluate each valid group, pick the best.
function botChooseGroup(room, bot) {
  const unused = room.dice.map((_, i) => i).filter((i) => !room.diceUsed[i]);
  const n = unused.length;
  let best = null;

  for (let mask = 1; mask < (1 << n); mask++) {
    let sum = 0;
    const indices = [];
    for (let b = 0; b < n; b++) {
      if (mask & (1 << b)) {
        sum += room.dice[unused[b]];
        indices.push(unused[b]);
      }
    }
    if (sum < 5 || sum > 10) continue;
    const mi = room.mountains.findIndex((m) => m.value === sum);
    if (mi < 0) continue;

    const score = scoreGroup(room, bot, indices, mi);
    if (!best || score > best.score) {
      best = { indices, mountainIndex: mi, score };
    }
  }

  return best && best.score > -Infinity ? best : null;
}

// Returns true if the current player should be auto-played (bot or disconnected human).
function shouldBotPlay(room) {
  if (!room || !room.started || room.finished) return false;
  const cur = room.players[room.currentIndex];
  if (!cur) return false;
  if (cur.isBot) return true;
  if (!cur.connected) return true; // disconnected human → substitute
  return false;
}

function scheduleBot(room, delay = 850) {
  if (!shouldBotPlay(room)) return;
  if (!hasHuman(room)) return; // pause if no humans are watching
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    botAct(room);
  }, delay);
}

function botAct(room) {
  try {
    if (!room || !room.started || room.finished) return;
    const cur = room.players[room.currentIndex];
    if (!cur) return;
    if (cur.connected && !cur.isBot) return;

    const label = cur.isBot ? cur.name : `Bot (for ${cur.name})`;

    if (!room.rolled) {
      room.dice = Array.from({ length: NUM_DICE }, () => 1 + Math.floor(Math.random() * 6));
      room.diceUsed = room.dice.map(() => false);
      room.adjustable = [];
      room.rolled = true;
      pushLog(room, `${label} rolled ${room.dice.join(', ')}.`);
      broadcast(room);
      scheduleBot(room, 850);
      return;
    }

    const group = botChooseGroup(room, cur);
    if (group) {
      applyClimb(room, cur, group.mountainIndex);
      group.indices.forEach((idx) => (room.diceUsed[idx] = true));
      room.adjustable = [];
      if (!room.finished && room.diceUsed.every((u) => u)) {
        advanceTurn(room);
        broadcast(room);
        // advanceTurn's setImmediate handles rescheduling
      } else {
        broadcast(room);
        scheduleBot(room, 650);
      }
      return;
    }

    // No useful group: end the turn.
    advanceTurn(room);
    broadcast(room);
    // advanceTurn's setImmediate handles rescheduling

  } catch (err) {
    console.error('[botAct] unexpected error — recovering:', err);
    try {
      if (room && room.started && !room.finished) {
        advanceTurn(room);
        broadcast(room);
      }
    } catch (e2) {
      console.error('[botAct] recovery also failed:', e2);
    }
  }
}

// ----------------------------------------------------------------------------
// Socket handlers
// ----------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name }, cb) => {
    name = (name || '').trim().slice(0, 16);
    if (!name) return cb && cb({ error: 'Please enter your name.' });
    const room = createRoom();
    socket.join(room.code);
    const player = addPlayer(room, socket.id, name);
    pushLog(room, `${name} created the room.`);
    cb && cb({ ok: true, code: room.code, youId: player.id });
    broadcast(room);
  });

  socket.on('joinRoom', ({ name, code }, cb) => {
    name = (name || '').trim().slice(0, 16);
    code = String(code || '').trim().slice(0, 4);
    const room = rooms[code];
    if (!room) return cb && cb({ error: 'Room not found.' });
    if (!name) return cb && cb({ error: 'Please enter your name.' });

    // Reconnect path:
    // In a started game we match by name even if still marked connected —
    // this handles the page-refresh race where the new socket arrives before
    // the server fires the disconnect event for the old socket.
    const existing = room.started
      ? room.players.find((p) => p.name === name && !p.isBot)
      : room.players.find((p) => p.name === name && !p.connected && !p.isBot);

    if (existing) {
      const wasMyTurn = room.players[room.currentIndex] &&
        room.players[room.currentIndex].id === existing.id;
      const wasDisconnected = !existing.connected;
      existing.id = socket.id;
      existing.connected = true;
      if (!room.hostId || !room.players.some((p) => p.id === room.hostId && p.connected)) {
        room.hostId = socket.id;
      }
      socket.join(room.code);
      if (room.started && wasDisconnected) {
        // Cancel any pending bot-substitution timer for this player.
        if (room.botTimer) {
          clearTimeout(room.botTimer);
          room.botTimer = null;
        }
        pushLog(room, `${name} reconnected. 👋`);
      }
      cb && cb({ ok: true, code: room.code, youId: socket.id });
      broadcast(room);
      // If it was their turn when they reconnected (and they're now live), let them play;
      // otherwise schedule the next bot turn normally.
      if (!wasMyTurn || wasDisconnected) scheduleBot(room, 100);
      return;
    }

    if (room.started) return cb && cb({ error: 'Game already started.' });
    if (room.players.length >= MAX_PLAYERS) return cb && cb({ error: 'Room is full.' });
    if (room.players.some((p) => p.name === name)) {
      return cb && cb({ error: 'Name already taken in this room.' });
    }
    socket.join(room.code);
    const player = addPlayer(room, socket.id, name);
    pushLog(room, `${name} joined.`);
    cb && cb({ ok: true, code: room.code, youId: player.id });
    broadcast(room);
  });

  socket.on('addBot', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.length >= MAX_PLAYERS) return;
    const bot = addBot(room);
    pushLog(room, `${bot.name} was added.`);
    broadcast(room);
  });

  socket.on('removeBot', ({ id }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    const idx = room.players.findIndex((p) => p.id === id && p.isBot);
    if (idx === -1) return;
    const [removed] = room.players.splice(idx, 1);
    pushLog(room, `${removed.name} was removed.`);
    if (room.currentIndex >= room.players.length) room.currentIndex = 0;
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.length < 2) return;
    resetForNewGame(room);
    room.started = true;
    pushLog(room, 'The climb begins! 🐐');
    startWatchdog(room);
    broadcast(room);
    scheduleBot(room);
  });

  socket.on('rollDice', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id || room.rolled) return;

    room.dice = Array.from({ length: NUM_DICE }, () => 1 + Math.floor(Math.random() * 6));
    room.diceUsed = room.dice.map(() => false);

    // "1s" rule: if more than one die shows 1, all but one may be re-faced.
    const ones = room.dice.map((d, i) => (d === 1 ? i : -1)).filter((i) => i >= 0);
    room.adjustable = ones.length >= 2 ? ones.slice(0, ones.length - 1) : [];

    room.rolled = true;
    pushLog(room, `${current.name} rolled ${room.dice.join(', ')}.`);
    broadcast(room);
  });

  // Re-face an "extra" 1 die to any value (only before any dice are used).
  socket.on('adjustDie', ({ index, value }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished || !room.rolled) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;
    if (room.diceUsed.some((u) => u)) return; // adjustments locked once you start moving
    if (!room.adjustable.includes(index)) return;
    value = parseInt(value, 10);
    if (!(value >= 1 && value <= 6)) return;
    room.dice[index] = value;
    broadcast(room);
  });

  // Apply a dice group (set of die indices) whose sum climbs the matching mountain.
  socket.on('moveGroup', ({ indices, mountainIndex }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished || !room.rolled) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;
    if (!Array.isArray(indices) || indices.length === 0) return;

    // validate indices: distinct, in range, not already used
    const seen = new Set();
    for (const idx of indices) {
      if (typeof idx !== 'number' || idx < 0 || idx >= room.dice.length) return;
      if (room.diceUsed[idx] || seen.has(idx)) return;
      seen.add(idx);
    }
    const m = room.mountains[mountainIndex];
    if (!m) return;
    const sum = indices.reduce((a, idx) => a + room.dice[idx], 0);
    if (sum !== m.value) return;

    applyClimb(room, current, mountainIndex);
    indices.forEach((idx) => (room.diceUsed[idx] = true));
    room.adjustable = []; // lock re-facing once a move is made

    if (!room.finished && room.diceUsed.every((u) => u)) {
      advanceTurn(room);
    }
    broadcast(room);
    scheduleBot(room);
  });

  socket.on('endTurn', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id || !room.rolled) return;
    advanceTurn(room);
    broadcast(room);
    scheduleBot(room);
  });

  socket.on('playAgain', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    resetForNewGame(room);
    room.started = true;
    room.log = [];
    pushLog(room, 'New game started! 🐐');
    startWatchdog(room);
    broadcast(room);
    scheduleBot(room);
  });

  socket.on('leaveRoom', () => handleDisconnect(socket, true));
  socket.on('disconnect', () => {
    // Small grace period so a page refresh can reconnect before we act on
    // the disconnect (avoids skipping the player's turn on refresh).
    setTimeout(() => handleDisconnect(socket, false), 3000);
  });
});

function handleDisconnect(socket, immediate = false) {
  const room = findRoomBySocket(socket.id);
  if (!room) return;
  const player = room.players.find((p) => p.id === socket.id);
  if (!player) return;

  // If not immediate (page refresh grace period), the player may have already
  // reconnected with a new socket id — if so, ignore this stale disconnect.
  if (!immediate && player.id !== socket.id) return;
  // Also skip if the player is already marked disconnected (reconnected and this
  // fired for the OLD socket).
  if (!immediate && !player.connected) return;

  if (!room.started) {
    room.players = room.players.filter((p) => p.id !== socket.id);
    pushLog(room, `${player.name} left.`);
    if (room.hostId === socket.id) {
      const nextHost = room.players.find((p) => !p.isBot);
      room.hostId = nextHost ? nextHost.id : null;
    }
    if (!hasHuman(room)) {
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.watchdog) clearInterval(room.watchdog);
      delete rooms[room.code];
      return;
    }
    if (room.currentIndex >= room.players.length) room.currentIndex = 0;
  } else {
    player.connected = false;
    pushLog(room, `${player.name} disconnected. Bot will play until they return.`);
    // Do NOT advance the turn — scheduleBot will handle playing their turn.
    if (room.hostId === socket.id) {
      const nextHost = room.players.find((p) => p.connected && !p.isBot);
      room.hostId = nextHost ? nextHost.id : room.hostId;
    }
    if (!hasHuman(room)) {
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.watchdog) clearInterval(room.watchdog);
      delete rooms[room.code];
      return;
    }
  }
  broadcast(room);
  scheduleBot(room, 1200); // slight extra delay so the disconnect message is visible
}

server.listen(PORT, () => {
  console.log(`Mountain Goats running on http://localhost:${PORT}`);
});

