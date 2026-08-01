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
const fs = require('fs');
const STATS_UNAVAILABLE_MSG = 'Data is not currently available.';
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
require('dotenv').config({ override: true });
const db = require('./db');
const auth = require('./auth');

const core = require('./game/core');
const scoringPkg = require('./game/scoring');
const teamsPkg = require('./game/teams');
const actions = require('./game/actions');
const matchPkg = require('./game/match');
const aiPkg = require('./game/ai');
const modesPkg = require('./game/modes');

const {
  MOUNTAIN_DEFS,
  NUM_DICE,
  MAX_PLAYERS,
  PLAYER_COLORS,
  TEAM_PALETTES,
  BOT_NAME_POOLS,
} = core.constants;
const { emptyMountainCount } = core.mountains;
const { createPlaceholderMountains, createBonusTokens, resetForNewGame } = core.state;
const { pickJoinColor } = require('./game/core/player-colors');
const {
  pointsOf,
  bonusOf,
  scoreOf,
  topsOf,
  setsOf,
} = scoringPkg.scoring;
const { rankedPlayers, rankedTeams } = scoringPkg.ranking;
const {
  getTeamOfPlayer,
  getTeamById,
  areTeammates,
  teamScoreOf,
  teamTopsOf,
  teamHighestTopValue,
} = teamsPkg.scoring;
const {
  assignPlayerTeamColor,
  assignAllTeamColors,
  getAllowedColorsForPlayer,
  buildTeams,
} = teamsPkg.lobby;
const { applyOnesRule, adjustDie: applyAdjustDie } = actions.dice;
const { advanceTurnState, isLastRoundComplete } = actions.turn;
const { cancelLobbyCleanup, removePlayerFromLobby } = actions.lobby;
const {
  toInt,
  toBool,
  isDistinctIntArray,
  safeHandler,
} = require('./game/validation');
const { applyClimb } = actions.climb;
const { buildMatchStatUpdates, resolveWinners, announceWinners } = matchPkg.winners;
const {
  botChooseGroup,
  botOptimizeAdjustableDice,
} = aiPkg.botChoose;
const { shouldBotPlay } = aiPkg.botPolicy;
const { getModeForRoom, setRoomMode, hasMode, resolveModeIdFromState, getMode, modeUsesTeams } = modesPkg;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 5000,
  pingTimeout: 10000,
});

/** @type {Map<string, string>} presenceId -> socketId */
const presenceSockets = new Map();

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/api/public-config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  });
});

app.post('/api/me/sync', async (req, res) => {
  if (!auth.isAuthConfigured()) {
    return res.status(503).json({ error: 'Auth not configured' });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const profile = await auth.syncAuthUser(token, db);
    console.log(`${auth.LOG_PREFIX} synced user ${profile.userId}`);
    res.json({
      ok: true,
      userId: profile.userId,
      gamingName: profile.gamingName || null,
    });
  } catch (err) {
    console.warn(`${auth.LOG_PREFIX} /api/me/sync failed:`, err.message);
    res.status(401).json({ error: err.message || 'Invalid token' });
  }
});

app.get('/api/me/stats', async (req, res) => {
  if (!auth.isAuthConfigured()) {
    return res.status(503).json({ error: 'Auth not configured' });
  }
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = await auth.verifyAccessToken(token);
    const userId = payload.sub;
    if (!(await db.ensureConnected())) {
      return res.status(503).json({ error: STATS_UNAVAILABLE_MSG });
    }
    const stats = await db.getMatchStats(userId);
    const emptyMode = { played: 0, won: 0, lost: 0 };
    res.json({
      matchesPlayed: stats ? stats.played : 0,
      matchesWon: stats ? stats.won : 0,
      matchesLost: stats ? stats.lost : 0,
      winStreak: stats ? stats.winStreak : 0,
      bestWinStreak: stats ? stats.bestWinStreak : 0,
      standard: stats ? stats.standard : emptyMode,
      team: stats ? stats.team : emptyMode,
      modes: {
        standard: stats ? stats.standard : emptyMode,
        team: stats ? stats.team : emptyMode,
      },
    });
  } catch (err) {
    console.warn(`${auth.LOG_PREFIX} /api/me/stats failed:`, err.message);
    res.status(401).json({ error: err.message || 'Invalid token' });
  }
});

app.get('/api/leaderboard', async (req, res) => {
  if (!(await db.ensureConnected())) {
    return res.status(503).json({ error: STATS_UNAVAILABLE_MSG });
  }
  try {
    const viewerId = String(req.query.viewerId || '').trim();
    const rows = await db.getLeaderboard(10);
    if (!rows) {
      return res.status(503).json({ error: STATS_UNAVAILABLE_MSG });
    }
    const entries = rows.map((row, index) => {
      const entry = {
        rank: index + 1,
        userId: row.userId,
        name: row.name,
        wins: row.wins,
        played: row.played,
        avatarUrl: row.avatarUrl,
      };
      if (viewerId && row.userId === viewerId) {
        entry.isMe = true;
      }
      return entry;
    });
    res.json({ entries });
  } catch (err) {
    console.warn('[leaderboard] GET /api/leaderboard failed:', err.message);
    res.status(503).json({ error: STATS_UNAVAILABLE_MSG });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Admin secret key - set via environment variable or defaults to a random key
const ADMIN_KEY = process.env.ADMIN_KEY || 'goat-admin-' + Math.random().toString(36).slice(2, 8);
console.log(`Admin key: ${ADMIN_KEY}`);

// Admin API - returns all active rooms and players
app.get('/api/admin/rooms', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key' });
  const data = [];
  for (const code in rooms) {
    const room = rooms[code];
    const host = room.players.find((p) => p.id === room.hostId);
    data.push({
      code: room.code,
      hostName: host ? host.name : 'Unknown',
      isPublic: room.isPublic,
      maxPlayers: room.maxPlayers,
      started: room.started,
      finished: room.finished,
      teamMode: room.teamMode,
      modeId: resolveModeIdFromState(room),
      playerCount: room.players.length,
      players: room.players.map((p) => ({
        name: p.name,
        isBot: p.isBot,
        connected: p.connected,
        score: room.started ? scoreOf(room, p) : 0,
      })),
    });
  }
  res.json({ rooms: data, totalConnections: io.sockets.sockets.size });
});

// Admin API - completed games from the last 2 days
app.get('/api/admin/history', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).json({ error: 'Invalid admin key' });
  res.json({ games: gameHistory });
});

// Admin page
app.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_KEY) return res.status(403).send('Access denied. Provide ?key=YOUR_ADMIN_KEY');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mountain Goats Admin</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; background: #0b1220; color: #eaf0ff; margin: 0; padding: 20px; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    .meta { color: #93a0bf; font-size: 14px; margin-bottom: 20px; }
    .refresh-btn { background: #4f7cff; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .refresh-btn:hover { background: #6f5cff; }
    .stats { display: flex; gap: 16px; margin-bottom: 20px; }
    .stat-card { background: rgba(22,31,51,0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px 20px; flex: 1; }
    .stat-num { font-size: 28px; font-weight: 800; color: #ffd166; }
    .stat-label { font-size: 12px; color: #93a0bf; margin-top: 4px; }
    .room { background: rgba(22,31,51,0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 16px; margin-bottom: 12px; }
    .room-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .room-code { font-weight: 800; color: #ffd166; font-size: 18px; }
    .room-badges span { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-left: 6px; }
    .badge-public { background: rgba(6,214,160,0.2); color: #06d6a0; }
    .badge-private { background: rgba(147,160,191,0.2); color: #93a0bf; }
    .badge-started { background: rgba(79,124,255,0.2); color: #4f7cff; }
    .badge-lobby { background: rgba(255,209,102,0.2); color: #ffd166; }
    .badge-team { background: rgba(111,92,255,0.2); color: #b9aaff; }
    .player-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.05); font-size: 14px; }
    .player-row:first-child { border-top: none; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
    .dot.online { background: #06d6a0; }
    .dot.offline { background: #ff5d6c; }
    .player-name { flex: 1; }
    .player-type { color: #93a0bf; font-size: 12px; }
    .no-rooms { color: #93a0bf; text-align: center; padding: 40px; }
    .auto-refresh { color: #93a0bf; font-size: 12px; margin-left: 12px; }
    .section-title { font-size: 16px; font-weight: 800; margin: 28px 0 12px; color: #eaf0ff; }
    .history-game { background: rgba(22,31,51,0.7); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; }
    .history-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; flex-wrap: wrap; }
    .history-title { font-weight: 800; color: #ffd166; font-size: 15px; }
    .history-sub { color: #93a0bf; font-size: 12px; margin-top: 3px; }
    .history-badges span { display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 700; margin-left: 6px; }
    .badge-finished { background: rgba(6,214,160,0.18); color: #06d6a0; }
    .badge-abandoned { background: rgba(255,93,108,0.18); color: #ff8a95; }
    .history-winner { font-size: 13px; font-weight: 700; color: #06d6a0; white-space: nowrap; }
    .history-winner.abandoned { color: #ff8a95; }
    .history-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .history-table th, .history-table td { text-align: left; padding: 5px 8px; border-top: 1px solid rgba(255,255,255,0.05); }
    .history-table th { color: #93a0bf; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
    .history-table tr:first-child th, .history-table tr:first-child td { border-top: none; }
    .history-table .win-row td { color: #ffd166; font-weight: 700; }
    .coin { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800; color: #08101f; vertical-align: middle; margin-right: 6px; box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.45); }
    .team-block { margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.06); }
    .team-block-title { font-size: 12px; font-weight: 800; margin-bottom: 4px; }
  </style>
</head>
<body>
  <h1>🐐 Mountain Goats Admin</h1>
  <p class="meta">Live server dashboard <button class="refresh-btn" onclick="load()">Refresh</button><span class="auto-refresh">Auto-refreshes every 5s</span></p>
  <div class="stats">
    <div class="stat-card"><div class="stat-num" id="s-conn">-</div><div class="stat-label">Connections</div></div>
    <div class="stat-card"><div class="stat-num" id="s-rooms">-</div><div class="stat-label">Active Rooms</div></div>
    <div class="stat-card"><div class="stat-num" id="s-playing">-</div><div class="stat-label">In-Game</div></div>
    <div class="stat-card"><div class="stat-num" id="s-history">-</div><div class="stat-label">Games (2 days)</div></div>
  </div>
  <h2 class="section-title">Live Rooms</h2>
  <div id="rooms-list"></div>
  <h2 class="section-title">Games (Last 2 Days)</h2>
  <div id="history-list"></div>
  <script>
    const KEY = new URLSearchParams(location.search).get('key');
    function esc(s) {
      return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function fmtDate(ts) {
      if (!ts) return 'Unknown time';
      return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function fmtDuration(ms) {
      if (ms == null || ms < 0) return '-';
      const sec = Math.round(ms / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      if (m >= 60) {
        const h = Math.floor(m / 60);
        const rm = m % 60;
        return h + 'h ' + rm + 'm';
      }
      return m > 0 ? m + 'm ' + s + 's' : s + 's';
    }
    function fmtEndReason(reason) {
      if (reason === 'bonus') return 'All bonus tokens claimed';
      if (reason === 'empty') return '3 mountains emptied';
      if (reason === 'abandoned') return 'Last player left mid-game';
      return reason || 'Completed';
    }
    function coin(color, name) {
      const initial = esc((name || '?').charAt(0).toUpperCase());
      return '<span class="coin" style="background:' + esc(color || '#666') + '">' + initial + '</span>';
    }
    function renderPlayerRows(players, winnerName) {
      const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
      return sorted.map((p) => {
        const win = p.name === winnerName;
        return '<tr class="' + (win ? 'win-row' : '') + '">' +
          '<td>' + coin(p.color, p.name) + esc(p.name) + (p.isBot ? ' <span style="color:#93a0bf;font-size:11px">🤖</span>' : '') + '</td>' +
          '<td>⭐ ' + (p.score || 0) + '</td>' +
          '<td>' + (p.points || 0) + '</td>' +
          '<td>' + (p.bonusPoints || 0) + '</td>' +
        '</tr>';
      }).join('');
    }
    function isTeamEntry(entry) {
      if (!entry) return false;
      if (entry.teamMode) return true;
      const modeId = entry.modeId || entry.mode;
      return modeId === 'standardTeam' || modeId === 'team';
    }
    function renderHistory(games) {
      const list = document.getElementById('history-list');
      document.getElementById('s-history').textContent = games.length;
      if (!games.length) {
        list.innerHTML = '<div class="no-rooms">No completed games in the last 2 days</div>';
        return;
      }
      list.innerHTML = games.map((g) => {
        const isTeam = isTeamEntry(g);
        const badges = [
          isTeam ? '<span class="badge-team">TEAMS</span>' : '',
          g.abandoned ? '<span class="badge-abandoned">ABANDONED</span>' : '<span class="badge-finished">FINISHED</span>',
        ].join('');
        let winnerLabel, winnerIcon;
        if (g.abandoned) {
          winnerIcon = '🚪';
          winnerLabel = isTeam && g.winnerTeam
            ? 'Leader: Team ' + esc(g.winnerTeam)
            : (g.winner ? 'Leader: ' + esc(g.winner) : 'No progress');
        } else {
          winnerIcon = '🏆';
          winnerLabel = isTeam && g.winnerTeam
            ? 'Team ' + esc(g.winnerTeam) + (g.winner ? ' (' + esc(g.winner) + ')' : '')
            : esc(g.winner || 'Unknown');
        }
        let stats = '<table class="history-table"><thead><tr>' +
          '<th>Player</th><th>Score</th><th>Points</th><th>Bonus</th>' +
          '</tr></thead><tbody>' + renderPlayerRows(g.players || [], g.winner) + '</tbody></table>';
        if (isTeam && g.teams && g.teams.length) {
          stats += g.teams.map((t) =>
            '<div class="team-block">' +
              '<div class="team-block-title" style="color:' + esc(t.color) + '">Team ' + esc(t.name) +
                ' · ⭐ ' + (t.score || 0) +
                ' · ' + esc((t.members || []).join(', ')) +
              '</div>' +
            '</div>'
          ).join('');
        }
        return '<div class="history-game">' +
          '<div class="history-head">' +
            '<div>' +
              '<div class="history-title">Room ' + esc(g.code) + ' · ' + (g.playerCount || 0) + ' players</div>' +
              '<div class="history-sub">' + fmtDate(g.endedAt) + ' · ' + fmtDuration(g.durationMs) + ' · ' + esc(fmtEndReason(g.endReason)) + '</div>' +
            '</div>' +
            '<div><div class="history-winner' + (g.abandoned ? ' abandoned' : '') + '">' + winnerIcon + ' ' + winnerLabel + '</div><div class="history-badges">' + badges + '</div></div>' +
          '</div>' + stats + '</div>';
      }).join('');
    }
    async function load() {
      try {
        const [roomsRes, histRes] = await Promise.all([
          fetch('/api/admin/rooms?key=' + encodeURIComponent(KEY)),
          fetch('/api/admin/history?key=' + encodeURIComponent(KEY)),
        ]);
        const data = await roomsRes.json();
        const hist = await histRes.json();
        document.getElementById('s-conn').textContent = data.totalConnections;
        document.getElementById('s-rooms').textContent = data.rooms.length;
        document.getElementById('s-playing').textContent = data.rooms.filter(r => r.started && !r.finished).length;
        renderHistory(hist.games || []);
        const list = document.getElementById('rooms-list');
        if (!data.rooms.length) { list.innerHTML = '<div class="no-rooms">No active rooms</div>'; return; }
        list.innerHTML = data.rooms.map(r => {
          const badges = [
            r.isPublic ? '<span class="badge-public">PUBLIC</span>' : '<span class="badge-private">PRIVATE</span>',
            r.started ? (r.finished ? '<span class="badge-lobby">FINISHED</span>' : '<span class="badge-started">IN GAME</span>') : '<span class="badge-lobby">LOBBY</span>',
            isTeamEntry(r) ? '<span class="badge-team">TEAMS</span>' : '',
          ].join('');
          const players = r.players.map(p =>
            '<div class="player-row">' +
              '<div class="dot ' + (p.connected ? 'online' : 'offline') + '"></div>' +
              '<span class="player-name">' + esc(p.name) + '</span>' +
              '<span class="player-type">' + (p.isBot ? '🤖 Bot' : '👤 Human') + '</span>' +
              (r.started ? '<span style="color:#ffd166;font-size:12px;font-weight:700">⭐' + p.score + '</span>' : '') +
            '</div>'
          ).join('');
          return '<div class="room">' +
            '<div class="room-header">' +
              '<div><span class="room-code">Room ' + esc(r.code) + '</span> · Host: ' + esc(r.hostName) + ' · ' + r.playerCount + '/' + r.maxPlayers + ' players</div>' +
              '<div class="room-badges">' + badges + '</div>' +
            '</div>' + players + '</div>';
        }).join('');
      } catch(e) { console.error(e); }
    }
    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// Room state
// ----------------------------------------------------------------------------
function genRoomCode() {
  let code = '';
  do {
    code = String(Math.floor(1000 + Math.random() * 9000)); // 1000–9999
  } while (rooms[code]);
  return code;
}

const rooms = {}; // code -> room
const gameHistory = []; // completed games from the last 2 days
let historyStorage = 'file'; // 'postgresql' | 'file'
const HISTORY_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const HISTORY_DIR = process.env.GAME_HISTORY_DIR || path.join(__dirname, 'data');
const HISTORY_FILE = process.env.GAME_HISTORY_FILE || path.join(HISTORY_DIR, 'game-history.json');

function pruneGameHistory() {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  while (gameHistory.length && gameHistory[gameHistory.length - 1].endedAt < cutoff) {
    gameHistory.pop();
  }
}

/**
 * Load game history from disk into the in-memory buffer (local dev fallback).
 * Invalid or missing files are ignored so the server can still start.
 */
function loadGameHistoryFromFile() {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return;
    const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn('[history] Invalid game history file; starting fresh.');
      return;
    }
    gameHistory.length = 0;
    parsed.forEach((entry) => {
      if (entry && typeof entry.endedAt === 'number') {
        gameHistory.push(entry);
      }
    });
    gameHistory.sort((a, b) => b.endedAt - a.endedAt);
    pruneGameHistory();
    console.log(`[history] Loaded ${gameHistory.length} game(s) from ${HISTORY_FILE}`);
  } catch (err) {
    console.error('[history] Failed to load game history:', err.message);
  }
}

/**
 * Load game history from the database or local JSON file.
 *
 * @returns {Promise<void>}
 */
async function loadGameHistory() {
  if (db.isEnabled()) {
    try {
      await db.init();
      await db.pruneGameHistory(HISTORY_RETENTION_MS);
      const entries = await db.loadGameHistory(HISTORY_RETENTION_MS);
      gameHistory.length = 0;
      entries.forEach((entry) => gameHistory.push(entry));
      pruneGameHistory();
      console.log(`[history] Loaded ${gameHistory.length} game(s) from database`);
      historyStorage = 'postgresql';

      if (gameHistory.length === 0) {
        loadGameHistoryFromFile();
        if (gameHistory.length > 0) {
          for (const entry of gameHistory) {
            await db.saveGameHistory(entry);
          }
          console.log(`[history] Migrated ${gameHistory.length} game(s) from JSON to database`);
        }
      }
      return;
    } catch (err) {
      await db.resetPool();
      console.error('[history] Database load failed, falling back to file:', err.message);
    }
  }
  historyStorage = 'file';
  loadGameHistoryFromFile();
}

/**
 * Write the in-memory game history buffer to disk (atomic replace).
 */
function persistGameHistoryToFile() {
  try {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
    const tmpFile = HISTORY_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(gameHistory), 'utf8');
    fs.renameSync(tmpFile, HISTORY_FILE);
  } catch (err) {
    console.error('[history] Failed to save game history:', err.message);
  }
}

/**
 * Persist the most recently recorded game (in-memory buffer front).
 */
function persistGameHistory() {
  const entry = gameHistory[0];
  if (!entry) return;

  if (historyStorage === 'postgresql' && db.isConnected()) {
    db.saveGameHistory(entry)
      .then(() => db.pruneGameHistory(HISTORY_RETENTION_MS))
      .catch((err) => console.error('[history] Database save failed:', err.message));
    return;
  }
  persistGameHistoryToFile();
}

function createRoom(options = {}) {
  const code = genRoomCode();
  const room = {
    code,
    hostId: null,
    players: [],
    mountains: createPlaceholderMountains(),
    bonusTokens: createBonusTokens(),
    lastRound: false,
    started: false,
    finished: false,
    winnerId: null,
    winnerPlayerIds: [],
    currentIndex: 0,
    dice: null, // [d1..d4]
    diceUsed: [], // booleans per die
    adjustable: [], // die indices the player may re-face (extra 1s)
    rolled: false,
    log: [],
    botTimer: null,
    watchdog: null,
    // Room settings
    isPublic: !!options.isPublic,
    maxPlayers: Math.min(MAX_PLAYERS, Math.max(2, parseInt(options.maxPlayers, 10) || MAX_PLAYERS)),
    turnTimeSec: 0,
    turnDeadline: null,
    turnTimer: null,
    autoPlayTurn: false,
    // Game mode (teamMode kept in sync for client/DB compat)
    modeId: 'standard',
    teamMode: false,
    teams: null, // array of {id, name, color, members:[playerId...]}
    winnerTeamId: null,
  };
  rooms[code] = room;
  return room;
}

/**
 * Add a player (human or bot) to a room with a balanced join color.
 *
 * @param {object} room Room state.
 * @param {string} socketId Player id.
 * @param {string} name Display name.
 * @param {boolean} [isBot=false] Whether the player is a bot.
 * @param {string|null} [authUserId=null] Signed-in user id.
 * @returns {object}
 */
function addPlayer(room, socketId, name, isBot = false, authUserId = null) {
  const color = pickJoinColor(room);
  const player = {
    id: socketId,
    name,
    color,
    isBot,
    authUserId: authUserId || null,
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

/**
 * Resolve an access token from a socket event or handshake.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} [eventToken] Token sent with the socket event.
 * @returns {string}
 */
function resolveSocketAccessToken(socket, eventToken) {
  const token = eventToken || (socket.handshake.auth && socket.handshake.auth.token) || '';
  return String(token).trim();
}

/**
 * Attach JWT auth to a socket without database sync.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} accessToken Supabase access token.
 * @returns {Promise<void>}
 */
async function ensureSocketAuthLight(socket, accessToken) {
  if (!auth.isAuthConfigured()) return;
  const token = resolveSocketAccessToken(socket, accessToken);
  if (!token) return;
  if (socket.authUserId) return;
  try {
    await auth.attachAuthToSocketLight(socket, token);
  } catch (err) {
    console.warn(`${auth.LOG_PREFIX} ensureSocketAuthLight failed:`, err.message);
  }
}

/**
 * Background DB sync, gaming name persistence, and lobby win counts.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {object} room Active room.
 * @param {string} name Resolved player name.
 * @param {string} accessToken Supabase access token.
 * @returns {Promise<void>}
 */
async function enrichSignedInPlayerContext(socket, room, name, accessToken) {
  if (!socket.authUserId) return;
  const token = resolveSocketAccessToken(socket, accessToken);
  if (!token) return;
  if (!(await db.ensureConnected())) return;

  try {
    if (!socket.authDbSynced) {
      const profile = await auth.syncAuthUserFromSocket(socket, token, db);
      socket.authGamingName = profile.gamingName || socket.authGamingName;
      socket.authGoogleName = profile.googleName || socket.authGoogleName;
      socket.authAvatarUrl = profile.avatarUrl || socket.authAvatarUrl;
      socket.authDbSynced = true;
    }
    await persistGamingName(socket, name);
    await refreshRoomPlayerWins(room);
    if (rooms[room.code]) broadcast(room);
  } catch (err) {
    console.warn(`${auth.LOG_PREFIX} enrichSignedInPlayerContext failed:`, err.message);
  }
}

/**
 * Re-attach auth from the socket handshake token when middleware missed it.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @returns {Promise<void>}
 */
async function syncSocketAuth(socket) {
  if (!auth.isAuthConfigured()) return;
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return;
  if (socket.authUserId) return;
  try {
    await auth.attachAuthToSocketLight(socket, token);
  } catch (err) {
    console.warn(`${auth.LOG_PREFIX} syncSocketAuth failed:`, err.message);
  }
}

/**
 * Ensure socket auth is attached and the user row exists in Postgres.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @returns {Promise<void>}
 */
async function ensureSocketAuthUserSynced(socket) {
  await syncSocketAuth(socket);
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token || !socket.authUserId) return;
  if (!(await db.ensureConnected())) return;
  try {
    const profile = await auth.syncAuthUser(token, db);
    socket.authGamingName = profile.gamingName || socket.authGamingName;
    socket.authGoogleName = profile.googleName || socket.authGoogleName;
    socket.authAvatarUrl = profile.avatarUrl || socket.authAvatarUrl;
  } catch (err) {
    console.warn(`${auth.LOG_PREFIX} ensureSocketAuthUserSynced failed:`, err.message);
  }
}

/**
 * Load overall match wins for a signed-in lobby player.
 *
 * @param {object} player Room player object.
 * @returns {Promise<void>}
 */
async function attachPlayerTotalWins(player) {
  if (!player || player.isBot || !player.authUserId) {
    player.totalWins = null;
    return;
  }
  if (!(await db.ensureConnected())) {
    player.totalWins = null;
    return;
  }
  const stats = await db.getMatchStats(player.authUserId);
  player.totalWins = stats ? stats.won : 0;
}

/**
 * Refresh overall win counts for all signed-in players in the lobby.
 *
 * @param {object} room Active room.
 * @returns {Promise<void>}
 */
async function refreshRoomPlayerWins(room) {
  if (!room || room.started) return;
  await Promise.all(room.players.map((player) => attachPlayerTotalWins(player)));
}

function pickBotName(room) {
  const botIndex = room.players.filter((p) => p.isBot).length;
  if (botIndex >= BOT_NAME_POOLS.length) return null;
  const used = new Set(room.players.map((p) => p.name));
  const pool = BOT_NAME_POOLS[botIndex].filter((n) => !used.has(n));
  const candidates = pool.length ? pool : BOT_NAME_POOLS[botIndex];
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function addBot(room) {
  const name = pickBotName(room);
  if (!name) return null;
  const id = 'bot_' + Math.random().toString(36).slice(2, 9);
  return addPlayer(room, id, name, true);
}

function hasHuman(room) {
  return room.players.some((p) => !p.isBot && p.connected);
}

function publicState(room) {
  const st = {
    code: room.code,
    hostId: room.hostId,
    isPublic: room.isPublic || false,
    maxPlayers: room.maxPlayers || MAX_PLAYERS,
    turnTimeSec: room.turnTimeSec || 0,
    turnDeadline: room.turnDeadline || null,
    started: room.started,
    finished: room.finished,
    winnerId: room.winnerId,
    winnerPlayerIds: room.winnerPlayerIds || (room.winnerId ? [room.winnerId] : []),
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
    playerColors: PLAYER_COLORS,
    modeId: resolveModeIdFromState(room),
    ...getModeForRoom(room).extraPublicState(room),
    players: room.players.map((p) => {
      const pTeam = getTeamOfPlayer(room, p.id);
      return {
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
        teamId: pTeam ? pTeam.id : null,
        totalWins: !p.isBot && p.authUserId != null ? (p.totalWins ?? null) : null,
      };
    }),
    log: room.log.slice(-14),
    // Team data
    teamMode: room.teamMode || false,
    teams: room.teams ? room.teams.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      members: t.members,
      score: teamScoreOf(room, t),
      tops: teamTopsOf(room, t),
      highTop: teamHighestTopValue(room, t),
    })) : null,
    winnerTeamId: room.winnerTeamId != null ? room.winnerTeamId : null,
  };
  return st;
}

function broadcast(room) {
  io.to(room.code).emit('state', publicState(room));
}

function pushLog(room, text) {
  room.log.push({ t: Date.now(), text });
}

const TURN_TIME_OPTIONS = new Set([0, 10, 15, 20, 30, 45, 60]);

/**
 * Clear the per-turn countdown timeout and deadline.
 * @param {object} room
 */
function clearTurnTimer(room) {
  if (!room) return;
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }
  room.turnDeadline = null;
}

/**
 * Arm a whole-turn timer for the current connected human player.
 * On expiry, bot finishes the turn via scheduleBot.
 * @param {object} room
 */
function armTurnTimer(room) {
  clearTurnTimer(room);
  if (!room || !room.started || room.finished) return;
  const sec = room.turnTimeSec || 0;
  if (sec <= 0 || room.autoPlayTurn) return;
  const cur = room.players[room.currentIndex];
  if (!cur || cur.isBot || !cur.connected) return;

  const playerName = cur.name;
  const deadline = Date.now() + sec * 1000;
  room.turnDeadline = deadline;
  room.turnTimer = setTimeout(() => {
    if (!rooms[room.code] || room.finished || !room.started) return;
    if (room.turnDeadline !== deadline) return;
    room.turnTimer = null;
    room.turnDeadline = null;
    room.autoPlayTurn = true;
    pushLog(room, `Time's up! Bot plays for ${playerName}.`);
    broadcast(room);
    scheduleBot(room);
  }, sec * 1000);
}

function advanceTurn(room) {
  if (room.players.length === 0) return;
  clearTurnTimer(room);
  room.autoPlayTurn = false;

  advanceTurnState(room);

  if (isLastRoundComplete(room)) endGame(room);

  // Always schedule the next bot turn from inside advanceTurn —
  // this guarantees no turn is ever silently dropped regardless of call site.
  if (!room.finished) {
    armTurnTimer(room);
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

/**
 * Record a completed or abandoned game into the in-memory history buffer.
 *
 * @param {object} room The room whose game just ended.
 * @param {object} [options] Recording options.
 * @param {boolean} [options.abandoned] True when the game was torn down before
 *   reaching its natural end (e.g. the last human left mid-game). Abandoned
 *   games still get recorded so solo/bot games do not silently disappear.
 */
function recordGameHistory(room, options = {}) {
  const abandoned = !!options.abandoned;
  const mode = getModeForRoom(room);
  const usesTeams = modeUsesTeams(mode);
  const entry = {
    code: room.code,
    endedAt: Date.now(),
    startedAt: room.startedAt || null,
    durationMs: room.startedAt ? Date.now() - room.startedAt : null,
    playerCount: room.players.length,
    endReason: abandoned ? 'abandoned' : (room.endReason || null),
    abandoned,
    modeId: mode.id,
    teamMode: room.teamMode || false,
    winner: null,
    winnerTeam: null,
    players: room.players.map((p) => ({
      name: p.name,
      isBot: p.isBot,
      color: p.color,
      score: scoreOf(room, p),
      points: pointsOf(room, p),
      bonusPoints: bonusOf(p),
      tops: topsOf(room, p),
      sets: Math.max(0, setsOf(p)),
    })),
    teams: null,
  };
  if (usesTeams && room.teams) {
    entry.teams = room.teams.map((t) => ({
      name: t.name,
      color: t.color,
      score: teamScoreOf(room, t),
      tops: teamTopsOf(room, t),
      members: t.members.map((pid) => {
        const p = room.players.find((pl) => pl.id === pid);
        return p ? p.name : '?';
      }),
    }));
  }
  // For finished games the winner is set by endGame. For abandoned games there
  // is no official winner, so fall back to the current leader for display.
  let winner = room.players.find((p) => p.id === room.winnerId);
  if (!winner && abandoned) {
    const ranked = rankedPlayers(room);
    winner = ranked.length ? ranked[0].p : null;
  }
  entry.winner = winner ? winner.name : null;
  if (room.winnerTeamId != null && room.teams) {
    const wt = room.teams.find((t) => t.id === room.winnerTeamId);
    entry.winnerTeam = wt ? wt.name : null;
  } else if (abandoned && usesTeams && room.teams) {
    const ranked = rankedTeams(room);
    const wt = ranked.length ? ranked[0].team : null;
    entry.winnerTeam = wt ? wt.name : null;
  }
  gameHistory.unshift(entry);
  pruneGameHistory();
  persistGameHistory();
}

/**
 * Persist match stats and notify signed-in participants.
 *
 * @param {object} room Finished room.
 * @returns {Promise<void>}
 */
async function recordMatchStatsForRoom(room) {
  const updates = buildMatchStatUpdates(room);
  if (!updates.length || !(await db.ensureConnected())) return;

  const statsByUserId = await db.recordMatchStats(updates);
  for (const player of room.players) {
    if (player.isBot || !player.authUserId) continue;
    const stats = statsByUserId.get(player.authUserId);
    if (stats) player.totalWins = stats.won;
  }
  if (rooms[room.code]) {
    broadcast(room);
  }
  for (const [, socket] of io.sockets.sockets) {
    if (!socket.authUserId || !statsByUserId.has(socket.authUserId)) continue;
    const stats = statsByUserId.get(socket.authUserId);
    socket.emit('match-stats', {
      matchesPlayed: stats.played,
      matchesWon: stats.won,
      matchesLost: stats.lost,
      winStreak: stats.winStreak,
      bestWinStreak: stats.bestWinStreak,
      standard: stats.standard,
      team: stats.team,
      modes: {
        standard: stats.standard,
        team: stats.team,
      },
    });
  }
}

async function endGame(room) {
  if (room.watchdog) { clearInterval(room.watchdog); room.watchdog = null; }
  clearTurnTimer(room);
  room.autoPlayTurn = false;

  resolveWinners(room);
  announceWinners(room, (msg) => pushLog(room, msg));

  try {
    await recordMatchStatsForRoom(room);
  } catch (err) {
    console.error('[stats] recordMatchStats failed:', err.message);
  }

  recordGameHistory(room);
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

/**
 * Roll four dice for the current turn and apply the multiple-1s rule.
 *
 * @param {object} room Active room.
 */
function rollDiceForTurn(room) {
  room.dice = Array.from({ length: NUM_DICE }, () => 1 + Math.floor(Math.random() * 6));
  room.diceUsed = room.dice.map(() => false);
  applyOnesRule(room);
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
    if (cur.connected && !cur.isBot && !room.autoPlayTurn) return;

    const label = cur.isBot ? cur.name : `Bot (for ${cur.name})`;
    const log = (msg) => pushLog(room, msg);

    if (!room.rolled) {
      rollDiceForTurn(room);
      room.rolled = true;
      pushLog(room, `${label} rolled ${room.dice.join(', ')}.`);
      if (room.adjustable.length) {
        botOptimizeAdjustableDice(room, cur, label, log);
      }
      broadcast(room);
      scheduleBot(room, 850);
      return;
    }

    if (room.adjustable.length) {
      botOptimizeAdjustableDice(room, cur, label, log);
    }

    const group = botChooseGroup(room, cur);
    if (group) {
      applyClimb(room, cur, group.mountainIndex, log);
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
// Broadcast online player count to all connected clients
let onlineCountBroadcastTimer = null;

function broadcastOnlineCount() {
  const count = io.sockets.sockets.size;
  io.emit('onlineCount', count);
}

/**
 * Debounce online count broadcasts so connect/disconnect races settle first.
 */
function scheduleBroadcastOnlineCount() {
  if (onlineCountBroadcastTimer) clearTimeout(onlineCountBroadcastTimer);
  onlineCountBroadcastTimer = setTimeout(() => {
    onlineCountBroadcastTimer = null;
    broadcastOnlineCount();
  }, 200);
}

/**
 * Evict a stale socket when the same browser tab reconnects after refresh.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 */
function takeOverPresenceSocket(socket) {
  const raw = socket.handshake.auth && socket.handshake.auth.presenceId;
  if (!raw || typeof raw !== 'string') return;
  const presenceId = raw.trim().slice(0, 64);
  if (!presenceId) return;

  socket.presenceId = presenceId;
  const previousSocketId = presenceSockets.get(presenceId);
  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) {
      previousSocket.disconnect(true);
    }
  }
  presenceSockets.set(presenceId, socket.id);
}

/**
 * Remove a tab presence entry when its socket disconnects.
 *
 * @param {import('socket.io').Socket} socket Disconnected socket.
 */
function releasePresenceSocket(socket) {
  const presenceId = socket.presenceId;
  if (!presenceId) return;
  if (presenceSockets.get(presenceId) === socket.id) {
    presenceSockets.delete(presenceId);
  }
}

/**
 * Find an existing human player for reconnect (auth id preferred over guest name).
 *
 * @param {object} room Room state.
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} name Resolved guest or display name.
 * @returns {object|undefined}
 */
function findExistingPlayer(room, socket, name) {
  return room.players.find((p) => {
    if (p.isBot) return false;
    if (socket.authUserId && p.authUserId) {
      return p.authUserId === socket.authUserId;
    }
    if (socket.authUserId && !p.authUserId && name && p.name === name) {
      return true;
    }
    if (!socket.authUserId && !p.authUserId) {
      return p.name === name;
    }
    return false;
  });
}

/**
 * Returns true if the player identity is already in the room (new join, not reconnect).
 *
 * @param {object} room Room state.
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} name Resolved display name.
 * @returns {boolean}
 */
function isPlayerIdentityTaken(room, socket, name) {
  if (socket.authUserId) {
    return room.players.some((p) => p.authUserId === socket.authUserId);
  }
  return room.players.some((p) => !p.isBot && !p.authUserId && p.name === name);
}

/**
 * Persist a signed-in user's chosen in-game name.
 *
 * @param {import('socket.io').Socket} socket Connected socket.
 * @param {string} name Resolved gaming name.
 * @returns {Promise<void>}
 */
async function persistGamingName(socket, name) {
  if (!socket.authUserId || !name) return;
  if (!(await db.ensureConnected())) {
    console.warn(`${auth.LOG_PREFIX} persistGamingName skipped: database not connected`);
    return;
  }
  try {
    await db.saveGamingName(socket.authUserId, name);
    socket.authGamingName = name;
  } catch (err) {
    console.error(`${auth.LOG_PREFIX} persistGamingName failed:`, err.message);
  }
}

io.use(async (socket, next) => {
  socket.authUserId = null;
  socket.authGoogleName = null;
  socket.authGamingName = null;
  socket.authAvatarUrl = null;
  socket.authEmail = null;
  socket.authDbSynced = false;
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (token && auth.isAuthConfigured()) {
    try {
      await auth.attachAuthToSocketLight(socket, token);
    } catch (err) {
      console.warn(`${auth.LOG_PREFIX} Invalid token on connect:`, err.message);
    }
  }
  next();
});

io.on('connection', (socket) => {
  takeOverPresenceSocket(socket);
  scheduleBroadcastOnlineCount();
  socket.on('disconnect', () => {
    releasePresenceSocket(socket);
    scheduleBroadcastOnlineCount();
  });

  socket.on('createRoom', safeHandler('createRoom', async ({ name, isPublic, maxPlayers, accessToken }, cb) => {
    const token = resolveSocketAccessToken(socket, accessToken);
    await ensureSocketAuthLight(socket, token);
    name = auth.resolvePlayerName(socket, name);
    if (!name) return cb && cb({ error: 'Please enter your name.' });
    const room = createRoom({ isPublic, maxPlayers });
    socket.join(room.code);
    const player = addPlayer(room, socket.id, name, false, socket.authUserId);
    pushLog(room, `${name} created the room.`);
    cb && cb({ ok: true, code: room.code, youId: player.id });
    broadcast(room);
    if (socket.authUserId) {
      enrichSignedInPlayerContext(socket, room, name, token).catch((err) => {
        console.warn(`${auth.LOG_PREFIX} createRoom enrichment failed:`, err.message);
      });
    }
  }));

  socket.on('joinRoom', safeHandler('joinRoom', async ({ name, code, accessToken }, cb) => {
    const token = resolveSocketAccessToken(socket, accessToken);
    await ensureSocketAuthLight(socket, token);
    name = auth.resolvePlayerName(socket, name);
    code = String(code || '').trim().slice(0, 4);
    const room = rooms[code];
    if (!room) return cb && cb({ error: 'Room not found.' });
    if (!name) return cb && cb({ error: 'Please enter your name.' });

    // Reconnect path:
    // Match by auth id (signed-in) or guest name. Handles page-refresh race.
    const existing = findExistingPlayer(room, socket, name);

    if (existing) {
      const wasMyTurn = room.players[room.currentIndex] &&
        room.players[room.currentIndex].id === existing.id;
      const wasDisconnected = !existing.connected;
      const oldId = existing.id;
      existing.id = socket.id;
      existing.connected = true;
      if (name) existing.name = name;
      if (socket.authUserId && !existing.authUserId) {
        existing.authUserId = socket.authUserId;
      }
      // Remap team / winner ids when player ID changes on reconnect
      if (oldId !== socket.id) {
        if (room.teams) {
          room.teams.forEach((t) => {
            const idx = t.members.indexOf(oldId);
            if (idx !== -1) t.members[idx] = socket.id;
          });
        }
        if (room.winnerId === oldId) room.winnerId = socket.id;
        if (Array.isArray(room.winnerPlayerIds) && room.winnerPlayerIds.length) {
          room.winnerPlayerIds = room.winnerPlayerIds.map((id) => (id === oldId ? socket.id : id));
        }
      }
      if (!room.hostId || !room.players.some((p) => p.id === room.hostId && p.connected)) {
        room.hostId = socket.id;
      }
      socket.join(room.code);
      // Cancel any pending bot-substitution timer for this player.
      if (room.started && wasDisconnected) {
        if (room.botTimer) {
          clearTimeout(room.botTimer);
          room.botTimer = null;
        }
      }
      // Cancel any pending lobby cleanup timer for this player.
      if (existing._lobbyCleanup) {
        clearTimeout(existing._lobbyCleanup);
        existing._lobbyCleanup = null;
      }
      if (room._finishedCleanup) {
        clearTimeout(room._finishedCleanup);
        room._finishedCleanup = null;
      }
      if (wasDisconnected) {
        pushLog(room, `${name} reconnected. 👋`);
      }
      cb && cb({ ok: true, code: room.code, youId: socket.id });
      broadcast(room);
      if (socket.authUserId) {
        enrichSignedInPlayerContext(socket, room, name, token).catch((err) => {
          console.warn(`${auth.LOG_PREFIX} joinRoom enrichment failed:`, err.message);
        });
      }
      // If it was their turn when they reconnected (and they're now live), let them play;
      // otherwise schedule the next bot turn normally.
      if (!wasMyTurn || wasDisconnected) scheduleBot(room, 100);
      return;
    }

    if (room.started) return cb && cb({ error: 'Game already started.' });
    if (room.players.length >= room.maxPlayers) return cb && cb({ error: 'Room is full.' });
    if (isPlayerIdentityTaken(room, socket, name)) {
      return cb && cb({ error: 'Name already taken in this room.' });
    }
    socket.join(room.code);
    const player = addPlayer(room, socket.id, name, false, socket.authUserId);
    getModeForRoom(room).onPlayerJoined(room, player);
    pushLog(room, `${name} joined.`);
    cb && cb({ ok: true, code: room.code, youId: player.id });
    broadcast(room);
    if (socket.authUserId) {
      enrichSignedInPlayerContext(socket, room, name, token).catch((err) => {
        console.warn(`${auth.LOG_PREFIX} joinRoom enrichment failed:`, err.message);
      });
    }
  }));

  socket.on('addBot', safeHandler('addBot', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.length >= room.maxPlayers) return;
    const bot = addBot(room);
    if (!bot) return;
    getModeForRoom(room).onPlayerJoined(room, bot);
    pushLog(room, `${bot.name} was added.`);
    broadcast(room);
  }));

  socket.on('setPlayerColor', safeHandler('setPlayerColor', ({ color, playerId }, cb) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.started) return cb && cb({ error: 'Cannot change colour now.' });
    const knownColors = new Set([...PLAYER_COLORS, ...TEAM_PALETTES.flat()]);
    if (!color || !knownColors.has(color)) return cb && cb({ error: 'Invalid colour.' });
    const targetId = playerId || socket.id;
    const target = room.players.find((p) => p.id === targetId);
    if (!target) return cb && cb({ error: 'Player not found.' });
    if (targetId !== socket.id && room.hostId !== socket.id) return cb && cb({ error: 'Not allowed.' });
    if (targetId === socket.id && target.isBot) return cb && cb({ error: 'Not allowed.' });
    const allowed = getAllowedColorsForPlayer(room, targetId);
    if (!allowed.includes(color)) return cb && cb({ error: 'Colour not available for this team.' });
    if (room.players.some((p) => p.id !== targetId && p.color === color)) return cb && cb({ error: 'Colour already taken.' });
    if (target.color === color) return cb && cb({ ok: true });
    target.color = color;
    broadcast(room);
    cb && cb({ ok: true });
  }));

  socket.on('removeBot', safeHandler('removeBot', ({ id }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    const idx = room.players.findIndex((p) => p.id === id && p.isBot);
    if (idx === -1) return;
    const [removed] = room.players.splice(idx, 1);
    // Remove from team membership
    if (room.teams) {
      room.teams.forEach((t) => {
        t.members = t.members.filter((mid) => mid !== id);
      });
    }
    pushLog(room, `${removed.name} was removed.`);
    if (room.currentIndex >= room.players.length) room.currentIndex = 0;
    broadcast(room);
  }));

  // Host kicks any player (human or bot) from the lobby
  socket.on('kickPlayer', safeHandler('kickPlayer', ({ id }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (id === socket.id) return; // can't kick yourself
    const kicked = removePlayerFromLobby(room, id);
    if (!kicked) return;
    pushLog(room, `${kicked.name} was kicked by the host.`);
    // Notify the kicked player with the host's name
    const hostPlayer = room.players.find((p) => p.id === room.hostId);
    io.to(id).emit('kicked', { hostName: hostPlayer ? hostPlayer.name : 'The host' });
    broadcast(room);
  }));

  // ---- Room settings socket events (lobby only) ----

  // Toggle room visibility (public/private)
  socket.on('setRoomVisibility', safeHandler('setRoomVisibility', ({ isPublic }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    room.isPublic = toBool(isPublic);
    broadcast(room);
  }));

  // Set max players for the room
  socket.on('setMaxPlayers', safeHandler('setMaxPlayers', ({ maxPlayers }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    const value = toInt(maxPlayers, { min: 2, max: MAX_PLAYERS });
    if (value === null) return;
    if (value < room.players.length) return; // can't set below current player count
    room.maxPlayers = value;
    broadcast(room);
  }));

  // Set per-turn time limit (0 = no limit). Host-only, lobby only.
  socket.on('setTurnTimer', safeHandler('setTurnTimer', ({ turnTimeSec }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    const value = toInt(turnTimeSec);
    if (value === null || !TURN_TIME_OPTIONS.has(value)) return;
    room.turnTimeSec = value;
    broadcast(room);
  }));

  // Get list of public rooms (for the join screen)
  socket.on('getPublicRooms', safeHandler('getPublicRooms', (_payload, cb) => {
    const publicRooms = [];
    for (const code in rooms) {
      const room = rooms[code];
      if (room.isPublic && !room.started && !room.finished) {
        const host = room.players.find((p) => p.id === room.hostId);
        // Count only connected players (and bots) for accurate display
        const connectedCount = room.players.filter((p) => p.connected || p.isBot).length;
        if (connectedCount === 0) continue; // skip empty rooms
        publicRooms.push({
          code: room.code,
          hostName: host ? host.name : 'Unknown',
          playerCount: connectedCount,
          maxPlayers: room.maxPlayers,
          modeId: resolveModeIdFromState(room),
          teamMode: room.teamMode || false,
        });
      }
    }
    cb && cb(publicRooms);
  }));

  // ---- Team mode socket events (lobby only) ----

  // Set game mode by id (host, lobby only)
  socket.on('setGameMode', safeHandler('setGameMode', ({ modeId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (!hasMode(modeId)) return;
    const log = (msg) => pushLog(room, msg);
    setRoomMode(room, modeId, log);
    broadcast(room);
  }));

  // Toggle team mode on/off (compat alias for setGameMode)
  socket.on('setTeamMode', safeHandler('setTeamMode', ({ enabled }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    const log = (msg) => pushLog(room, msg);
    setRoomMode(room, toBool(enabled) ? 'standardTeam' : 'standard', log);
    broadcast(room);
  }));

  // Change team configuration (number of teams)
  socket.on('setTeamConfig', safeHandler('setTeamConfig', ({ numTeams }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started || !room.teamMode) return;
    const value = toInt(numTeams, { min: 2, max: 3 });
    if (value === null) return;
    room.teams = buildTeams(room, value);
    assignAllTeamColors(room, true);
    const perTeam = Math.ceil(room.players.length / value);
    pushLog(room, `Teams reconfigured: ${value} teams of ~${perTeam}.`);
    broadcast(room);
  }));

  // Move a player to a different team (host only — can move anyone)
  socket.on('swapTeam', safeHandler('swapTeam', ({ playerId, toTeamId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started || !room.teamMode || !room.teams) return;
    toTeamId = toInt(toTeamId);
    if (toTeamId === null) return;
    const targetTeam = getTeamById(room, toTeamId);
    if (!targetTeam) return;
    // Verify the player exists in the room
    if (typeof playerId !== 'string' || !room.players.some((p) => p.id === playerId)) return;
    // Purge the player from EVERY team before adding — guards against a stale
    // cross-team duplicate silently inflating team sizes and breaking canStart.
    room.teams.forEach((t) => {
      t.members = t.members.filter((id) => id !== playerId);
    });
    targetTeam.members.push(playerId);
    assignPlayerTeamColor(room, playerId, true);
    broadcast(room);
  }));

  // Non-host player moves themselves to a different team
  socket.on('selfSwapTeam', safeHandler('selfSwapTeam', ({ toTeamId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.started || !room.teamMode || !room.teams) return;
    // Only allow moving yourself (not others)
    const playerId = socket.id;
    if (!room.players.some((p) => p.id === playerId)) return;
    toTeamId = toInt(toTeamId);
    if (toTeamId === null) return;
    const targetTeam = getTeamById(room, toTeamId);
    if (!targetTeam) return;
    const currentTeam = getTeamOfPlayer(room, playerId);
    if (currentTeam && currentTeam.id === toTeamId) return; // already on this team
    // Purge the player from EVERY team before adding (see swapTeam for rationale).
    room.teams.forEach((t) => {
      t.members = t.members.filter((id) => id !== playerId);
    });
    targetTeam.members.push(playerId);
    assignPlayerTeamColor(room, playerId, true);
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      pushLog(room, `${player.name} joined Team ${targetTeam.name}.`);
    }
    broadcast(room);
  }));

  socket.on('startGame', safeHandler('startGame', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;

    const log = (msg) => pushLog(room, msg);
    getModeForRoom(room).syncLobbyForStart(room, log, setRoomMode);

    const mode = getModeForRoom(room);
    const startCheck = mode.canStart(room);
    if (!startCheck.ok) {
      if (startCheck.reason) pushLog(room, startCheck.reason);
      broadcast(room);
      return;
    }

    mode.prepareStart(room);
    resetForNewGame(room);
    room.started = true;
    room.startedAt = Date.now();
    pushLog(room, getModeForRoom(room).startLogMessage(room));
    startWatchdog(room);
    armTurnTimer(room);
    broadcast(room);
    scheduleBot(room);
  }));

  socket.on('rollDice', safeHandler('rollDice', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished || room.autoPlayTurn) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id || room.rolled) return;

    rollDiceForTurn(room);
    room.rolled = true;
    pushLog(room, `${current.name} rolled ${room.dice.join(', ')}.`);
    broadcast(room);
  }));

  // Re-face an "extra" 1 die to any value (only before any dice are used).
  socket.on('adjustDie', safeHandler('adjustDie', ({ index, value }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished || !room.rolled || room.autoPlayTurn) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;
    if (!applyAdjustDie(room, index, value)) return;
    broadcast(room);
  }));

  // Apply a dice group (set of die indices) whose sum climbs the matching mountain.
  socket.on('moveGroup', safeHandler('moveGroup', ({ indices, mountainIndex }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished || !room.rolled || room.autoPlayTurn) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id) return;
    if (!isDistinctIntArray(indices, { min: 0, max: room.dice.length - 1, minLength: 1, maxLength: room.dice.length })) return;
    // Every index must still be unused this turn.
    for (const idx of indices) {
      if (room.diceUsed[idx]) return;
    }
    const mIdx = toInt(mountainIndex, { min: 0, max: room.mountains.length - 1 });
    if (mIdx === null) return;
    const m = room.mountains[mIdx];
    if (!m) return;
    const sum = indices.reduce((a, idx) => a + room.dice[idx], 0);
    if (sum !== m.value) return;

    const log = (msg) => pushLog(room, msg);
    applyClimb(room, current, mIdx, log);
    indices.forEach((idx) => (room.diceUsed[idx] = true));
    room.adjustable = []; // lock re-facing once a move is made

    if (!room.finished && room.diceUsed.every((u) => u)) {
      advanceTurn(room);
    }
    broadcast(room);
    scheduleBot(room);
  }));

  socket.on('endTurn', safeHandler('endTurn', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || !room.started || room.finished || room.autoPlayTurn) return;
    const current = room.players[room.currentIndex];
    if (!current || current.id !== socket.id || !room.rolled) return;
    advanceTurn(room);
    broadcast(room);
    scheduleBot(room);
  }));

  socket.on('playAgain', safeHandler('playAgain', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id) return;
    resetForNewGame(room);
    room.started = false; // go back to lobby so players can adjust
    room.log = [];
    if (room.watchdog) { clearInterval(room.watchdog); room.watchdog = null; }
    if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
    clearTurnTimer(room);
    room.autoPlayTurn = false;
    pushLog(room, 'Back to lobby — start when ready! 🐐');
    broadcast(room);
  }));

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
    if (immediate) {
      // Explicit leave: remove immediately.
      removePlayerFromLobby(room, socket.id);
      pushLog(room, `${player.name} left.`);
      if (!hasHuman(room)) {
        if (room.botTimer) clearTimeout(room.botTimer);
        if (room.watchdog) clearInterval(room.watchdog);
        clearTurnTimer(room);
        delete rooms[room.code];
        return;
      }
    } else {
      // Temporary disconnect (mobile app switch, network blip): keep the
      // player in the lobby for 30 seconds so they can reconnect seamlessly.
      player.connected = false;
      if (room.hostId === socket.id) {
        const nextHost = room.players.find((p) => p.connected && !p.isBot);
        room.hostId = nextHost ? nextHost.id : room.hostId;
      }
      // If no humans remain connected, delete the room now.
      if (!hasHuman(room)) {
        if (room.botTimer) clearTimeout(room.botTimer);
        if (room.watchdog) clearInterval(room.watchdog);
        clearTurnTimer(room);
        delete rooms[room.code];
        return;
      }
      // Schedule cleanup: remove from lobby after 30s if still disconnected.
      player._lobbyCleanup = setTimeout(() => {
        player._lobbyCleanup = null;
        if (!rooms[room.code]) return;
        if (player.connected || room.started) return; // reconnected or game started
        if (!removePlayerFromLobby(room, player.id)) return; // already removed (kicked, etc.)
        pushLog(room, `${player.name} timed out.`);
        if (!hasHuman(room)) {
          if (room.botTimer) clearTimeout(room.botTimer);
          if (room.watchdog) clearInterval(room.watchdog);
          clearTurnTimer(room);
          delete rooms[room.code];
          return;
        }
        if (room.currentIndex >= room.players.length) room.currentIndex = 0;
        broadcast(room);
      }, 30000);
    }
  } else {
    player.connected = false;
    pushLog(room, `${player.name} disconnected. Bot will play until they return.`);
    // Do NOT advance the turn — scheduleBot will handle playing their turn.
    const cur = room.players[room.currentIndex];
    if (cur === player) {
      clearTurnTimer(room);
      room.autoPlayTurn = false;
    }
    if (room.hostId === socket.id) {
      const nextHost = room.players.find((p) => p.connected && !p.isBot);
      room.hostId = nextHost ? nextHost.id : room.hostId;
    }
    if (!hasHuman(room)) {
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.watchdog) clearInterval(room.watchdog);
      clearTurnTimer(room);
      // Finished games: keep the room briefly so clients can rejoin and see the scorecard
      // after short disconnects (auth socket refresh, mobile backgrounding).
      if (room.finished) {
        if (!room._finishedCleanup) {
          room._finishedCleanup = setTimeout(() => {
            room._finishedCleanup = null;
            if (!rooms[room.code]) return;
            if (hasHuman(room)) return;
            clearTurnTimer(room);
            delete rooms[room.code];
          }, 10 * 60 * 1000);
        }
        broadcast(room);
        return;
      }
      // The last human left an in-progress game. Record it as abandoned so it
      // still appears in the admin history instead of vanishing silently.
      if (room.started) {
        recordGameHistory(room, { abandoned: true });
      }
      delete rooms[room.code];
      return;
    }
  }
  broadcast(room);
  scheduleBot(room, 1200); // slight extra delay so the disconnect message is visible
}

// ----------------------------------------------------------------------------
// Process-level safety net
// ----------------------------------------------------------------------------
// Node's default behavior on an uncaught exception or unhandled promise rejection
// is to crash the process. For a multiplayer game server that would drop every
// active room. Log loudly and keep serving — the offending socket/HTTP request
// still fails, but the other rooms continue. If problems compound, an operator
// can still restart via SIGTERM.
process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection:', reason && reason.stack ? reason.stack : reason);
});

// Startup-time server errors (EADDRINUSE, EACCES): print a targeted message
// instead of a raw crash so the operator knows to free the port.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[startup] Port ${PORT} is already in use. Stop the other server or set PORT to a free value.`);
  } else if (err && err.code === 'EACCES') {
    console.error(`[startup] Permission denied binding to port ${PORT}. Try a port >= 1024 or run with elevated privileges.`);
  } else {
    console.error('[startup] Server error:', err && err.stack ? err.stack : err);
  }
  process.exit(1);
});

// Graceful shutdown: stop accepting new connections, close open sockets so
// clients see a clean disconnect (which triggers their reconnect logic), and
// exit within a bounded window regardless of stuck sockets or DB handles.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, closing server...`);
  const forceExit = setTimeout(() => {
    console.warn('[shutdown] Timed out waiting for clean close; forcing exit.');
    process.exit(1);
  }, 8000);
  forceExit.unref();
  try { io.close(); } catch (_) { /* io may already be closing */ }
  server.close((err) => {
    if (err) console.error('[shutdown] server.close error:', err.message);
    process.exit(err ? 1 : 0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

loadGameHistory()
  .then(() => {
    server.listen(PORT, () => {
      const storage = historyStorage === 'postgresql' ? 'PostgreSQL' : 'local JSON file';
      console.log(`Mountain Goats running on http://localhost:${PORT} (history: ${storage})`);
    });
  })
  .catch((err) => {
    console.error('[startup] Failed to load game history:', err.message);
    process.exit(1);
  });

