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
      playerCount: room.players.length,
      players: room.players.map((p) => ({
        name: p.name,
        isBot: p.isBot,
        connected: p.connected,
        score: room.started ? scoreOf(room, p) : 0,
      })),
    });
  }
  res.json({ rooms: data, totalConnections: io.engine.clientsCount });
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
          '<td>👑 ' + (p.tops || 0) + '</td>' +
          '<td>' + (p.sets || 0) + '</td>' +
        '</tr>';
      }).join('');
    }
    function renderHistory(games) {
      const list = document.getElementById('history-list');
      document.getElementById('s-history').textContent = games.length;
      if (!games.length) {
        list.innerHTML = '<div class="no-rooms">No completed games in the last 2 days</div>';
        return;
      }
      list.innerHTML = games.map((g) => {
        const badges = [
          g.teamMode ? '<span class="badge-team">TEAMS</span>' : '',
          g.abandoned ? '<span class="badge-abandoned">ABANDONED</span>' : '<span class="badge-finished">FINISHED</span>',
        ].join('');
        let winnerLabel, winnerIcon;
        if (g.abandoned) {
          winnerIcon = '🚪';
          winnerLabel = g.teamMode && g.winnerTeam
            ? 'Leader: Team ' + esc(g.winnerTeam)
            : (g.winner ? 'Leader: ' + esc(g.winner) : 'No progress');
        } else {
          winnerIcon = '🏆';
          winnerLabel = g.teamMode && g.winnerTeam
            ? 'Team ' + esc(g.winnerTeam) + (g.winner ? ' (' + esc(g.winner) + ')' : '')
            : esc(g.winner || 'Unknown');
        }
        let stats = '<table class="history-table"><thead><tr>' +
          '<th>Player</th><th>Score</th><th>Points</th><th>Bonus</th><th>Tops</th><th>Sets</th>' +
          '</tr></thead><tbody>' + renderPlayerRows(g.players || [], g.winner) + '</tbody></table>';
        if (g.teamMode && g.teams && g.teams.length) {
          stats += g.teams.map((t) =>
            '<div class="team-block">' +
              '<div class="team-block-title" style="color:' + esc(t.color) + '">Team ' + esc(t.name) +
                ' · ⭐ ' + (t.score || 0) + ' · 👑 ' + (t.tops || 0) +
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
            r.teamMode ? '<span class="badge-team">TEAMS</span>' : '',
          ].join('');
          const players = r.players.map(p =>
            '<div class="player-row">' +
              '<div class="dot ' + (p.connected ? 'online' : 'offline') + '"></div>' +
              '<span class="player-name">' + p.name + '</span>' +
              '<span class="player-type">' + (p.isBot ? '🤖 Bot' : '👤 Human') + '</span>' +
              (r.started ? '<span style="color:#ffd166;font-size:12px;font-weight:700">⭐' + p.score + '</span>' : '') +
            '</div>'
          ).join('');
          return '<div class="room">' +
            '<div class="room-header">' +
              '<div><span class="room-code">Room ' + r.code + '</span> · Host: ' + r.hostName + ' · ' + r.playerCount + '/' + r.maxPlayers + ' players</div>' +
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
const PLAYER_COLORS = [
  '#e63946', // red
  '#4f7cff', // blue
  '#06d6a0', // mint green
  '#ff6b9d', // pink
  '#118ab2', // sky blue
  '#40916c', // forest green
  '#c1121f', // dark red
  '#1e40af', // navy blue
  '#22c55e', // grass green
  '#e67e22', // orange
];
// Bot names by creation order: 1st Z, 2nd Y, 3rd X, 4th W, 5th V (random pick from each pair)
const BOT_NAME_POOLS = [
  ['Zorro', 'Zenith'],
  ['Ymir', 'Yeti'],
  ['Xenon', 'Xander'],
  ['Wolf', 'Wraith'],
  ['Vector', 'Viper'],
];

// Team definitions
const TEAM_COLORS = ['#e63946', '#4f7cff', '#06d6a0'];
const TEAM_NAMES = ['Red', 'Blue', 'Green'];
// Three player shades per team (indices into PLAYER_COLORS)
const TEAM_PALETTE_INDICES = [
  [0, 3, 6], // Red
  [1, 4, 7], // Blue
  [2, 5, 8], // Green
];
const TEAM_PALETTES = TEAM_PALETTE_INDICES.map((indices) => indices.map((i) => PLAYER_COLORS[i]));
// Valid team configurations: [totalPlayers, numTeams, playersPerTeam]
const TEAM_CONFIGS = [
  { total: 4, teams: 2, perTeam: 2 },
  { total: 6, teams: 2, perTeam: 3 },
  { total: 6, teams: 3, perTeam: 2 },
];

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
// Team helpers
// ----------------------------------------------------------------------------
function getTeamOfPlayer(room, playerId) {
  if (!room.teamMode) return null;
  return room.teams ? room.teams.find((t) => t.members.includes(playerId)) : null;
}

function getTeamById(room, teamId) {
  if (!room.teams) return null;
  return room.teams.find((t) => t.id === teamId);
}

function getTeamPalette(teamId) {
  if (teamId == null || teamId < 0 || teamId >= TEAM_PALETTES.length) return null;
  return TEAM_PALETTES[teamId];
}

function getUsedColors(room, excludePlayerId) {
  return new Set(
    room.players
      .filter((p) => p.id !== excludePlayerId)
      .map((p) => p.color)
  );
}

function pickTeamColor(room, teamId, excludePlayerId, avoidColor) {
  const palette = getTeamPalette(teamId);
  if (!palette) return PLAYER_COLORS[0];
  const used = getUsedColors(room, excludePlayerId);
  let candidates = palette.filter((c) => !used.has(c));
  if (avoidColor) {
    const preferred = candidates.filter((c) => c !== avoidColor);
    if (preferred.length) candidates = preferred;
  }
  if (candidates.length) return candidates[0];
  return palette.find((c) => c !== avoidColor) || palette[0];
}

function assignPlayerTeamColor(room, playerId, forceNew) {
  const team = getTeamOfPlayer(room, playerId);
  if (!team) return;
  const player = room.players.find((p) => p.id === playerId);
  if (!player) return;
  const palette = getTeamPalette(team.id);
  if (!palette) return;
  if (!forceNew && palette.includes(player.color) && !getUsedColors(room, playerId).has(player.color)) {
    return;
  }
  player.color = pickTeamColor(room, team.id, playerId, forceNew ? player.color : null);
}

function assignAllTeamColors(room) {
  if (!room.teamMode || !room.teams) return;
  room.teams.forEach((team) => {
    team.members.forEach((pid) => assignPlayerTeamColor(room, pid, false));
  });
}

function getAllowedColorsForPlayer(room, playerId) {
  if (!room.teamMode || !room.teams) return PLAYER_COLORS;
  const team = getTeamOfPlayer(room, playerId);
  if (team) return getTeamPalette(team.id) || PLAYER_COLORS;
  const colors = [];
  const seen = new Set();
  room.teams.forEach((t) => {
    getTeamPalette(t.id).forEach((c) => {
      if (!seen.has(c)) {
        seen.add(c);
        colors.push(c);
      }
    });
  });
  return colors.length ? colors : PLAYER_COLORS;
}

function areTeammates(room, p1Id, p2Id) {
  if (!room.teamMode) return false;
  const t1 = getTeamOfPlayer(room, p1Id);
  const t2 = getTeamOfPlayer(room, p2Id);
  return t1 && t2 && t1.id === t2.id;
}

// Team score = sum of all members' individual scores
function teamScoreOf(room, team) {
  let total = 0;
  team.members.forEach((pid) => {
    const p = room.players.find((pl) => pl.id === pid);
    if (p) total += scoreOf(room, p);
  });
  return total;
}

// Team tops: count summits where at least one team member is on top
function teamTopsOf(room, team) {
  let n = 0;
  room.mountains.forEach((m, i) => {
    const hasTop = team.members.some((pid) => {
      const p = room.players.find((pl) => pl.id === pid);
      return p && p.pos[i] >= m.height;
    });
    if (hasTop) n++;
  });
  return n;
}

// Highest mountain value where team has a goat on top
function teamHighestTopValue(room, team) {
  let v = 0;
  room.mountains.forEach((m, i) => {
    const hasTop = team.members.some((pid) => {
      const p = room.players.find((pl) => pl.id === pid);
      return p && p.pos[i] >= m.height;
    });
    if (hasTop && m.value > v) v = m.value;
  });
  return v;
}

// Check if a summit already has a teammate on it (for team summit scoring rule)
function teamHasSummit(room, player, mountainIndex) {
  if (!room.teamMode) return false;
  const team = getTeamOfPlayer(room, player.id);
  if (!team) return false;
  const m = room.mountains[mountainIndex];
  return team.members.some((pid) => {
    if (pid === player.id) return false;
    const p = room.players.find((pl) => pl.id === pid);
    return p && p.pos[mountainIndex] >= m.height;
  });
}

// Get valid team configurations for the current player count
function getValidTeamConfigs(playerCount) {
  return TEAM_CONFIGS.filter((c) => c.total === playerCount);
}

// Build default team assignments for a configuration
function buildTeams(room, numTeams) {
  const teams = [];
  for (let t = 0; t < numTeams; t++) {
    teams.push({
      id: t,
      name: TEAM_NAMES[t],
      color: TEAM_COLORS[t],
      members: [],
    });
  }
  // Round-robin assign players
  room.players.forEach((p, idx) => {
    teams[idx % numTeams].members.push(p.id);
  });
  return teams;
}

// ----------------------------------------------------------------------------
// Room state
// ----------------------------------------------------------------------------
const rooms = {}; // code -> room
const gameHistory = []; // completed games from the last 2 days
const HISTORY_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

function pruneGameHistory() {
  const cutoff = Date.now() - HISTORY_RETENTION_MS;
  while (gameHistory.length && gameHistory[gameHistory.length - 1].endedAt < cutoff) {
    gameHistory.pop();
  }
}

function createRoom(options = {}) {
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
    // Room settings
    isPublic: !!options.isPublic,
    maxPlayers: Math.min(MAX_PLAYERS, Math.max(2, parseInt(options.maxPlayers, 10) || MAX_PLAYERS)),
    // Team mode (optional)
    teamMode: false,
    teams: null, // array of {id, name, color, members:[playerId...]}
    winnerTeamId: null,
  };
  rooms[code] = room;
  return room;
}

function addPlayer(room, socketId, name, isBot = false) {
  // Assign first unused color to ensure all players have unique colors
  const usedColors = new Set(room.players.map((p) => p.color));
  const color = PLAYER_COLORS.find((c) => !usedColors.has(c)) || PLAYER_COLORS[room.players.length % PLAYER_COLORS.length];
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

function resetForNewGame(room) {
  const count = room.players.filter((p) => p.connected).length || room.players.length;
  room.mountains = buildMountains(count);
  room.bonusTokens = [...BONUS_DEFS];
  room.lastRound = false;
  room.endReason = null;
  room.startedAt = null;
  room.finished = false;
  room.winnerId = null;
  room.winnerTeamId = null;
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
  // Team assignments persist across games (they're set in lobby)
}

function publicState(room) {
  const st = {
    code: room.code,
    hostId: room.hostId,
    isPublic: room.isPublic || false,
    maxPlayers: room.maxPlayers || MAX_PLAYERS,
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
    playerColors: PLAYER_COLORS,
    teamPalettes: room.teamMode ? TEAM_PALETTES : null,
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
    // In team mode, players can still harvest even if a teammate is also on the summit.
    if (m.chips > 0) {
      takeToken(room, player, i);
      pushLog(room, `${player.name} harvested a ${m.value}p token from Mountain ${m.value}.`);
    }
    return;
  }
  player.pos[i] += 1;
  if (player.pos[i] >= m.height) {
    if (room.teamMode) {
      // TEAM MODE: teammates can co-occupy summit. Only bump opposing team goats.
      const playerTeam = getTeamOfPlayer(room, player.id);
      let bumped = false;
      let bumpedTeamName = '';
      room.players.forEach((o) => {
        if (o.id !== player.id && o.pos[i] >= m.height) {
          if (areTeammates(room, player.id, o.id)) {
            // Teammate on summit — they stay (co-occupy).
          } else {
            // Opposing team: Team Wipeout — all opposing goats removed.
            o.pos[i] = 0;
            const oTeam = getTeamOfPlayer(room, o.id);
            bumpedTeamName = oTeam ? oTeam.name : '';
            bumped = true;
            pushLog(room, `${o.name}'s goat was wiped off the top of Mountain ${m.value}! (Team Wipeout)`);
          }
        }
      });
      if (bumped && bumpedTeamName) {
        pushLog(room, `Team ${bumpedTeamName} lost all goats on Mountain ${m.value} summit!`);
      }
      // Team summit scoring: teammate reaching the summit also scores
      if (m.chips > 0) {
        takeToken(room, player, i);
        const teammateAlreadyOnTop = teamHasSummit(room, player, i);
        if (teammateAlreadyOnTop) {
          pushLog(room, `${player.name} joined teammate on Mountain ${m.value} summit (+${m.value}).`);
        } else {
          pushLog(room, `${player.name} reached the top of Mountain ${m.value} (+${m.value}).`);
        }
      } else {
        pushLog(room, `${player.name} reached the top of Mountain ${m.value} (no tokens left).`);
      }
    } else {
      // STANDARD MODE: bump any other goat already there to the foot.
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

function rankedTeams(room) {
  if (!room.teamMode || !room.teams) return [];
  return room.teams
    .map((t) => ({
      team: t,
      score: teamScoreOf(room, t),
      tops: teamTopsOf(room, t),
      highTop: teamHighestTopValue(room, t),
    }))
    .sort((a, b) => b.score - a.score || b.tops - a.tops || b.highTop - a.highTop);
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
  const entry = {
    code: room.code,
    endedAt: Date.now(),
    startedAt: room.startedAt || null,
    durationMs: room.startedAt ? Date.now() - room.startedAt : null,
    playerCount: room.players.length,
    endReason: abandoned ? 'abandoned' : (room.endReason || null),
    abandoned,
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
  if (room.teamMode && room.teams) {
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
  } else if (abandoned && room.teamMode && room.teams) {
    const ranked = rankedTeams(room);
    const wt = ranked.length ? ranked[0].team : null;
    entry.winnerTeam = wt ? wt.name : null;
  }
  gameHistory.unshift(entry);
  pruneGameHistory();
}

function endGame(room) {
  room.finished = true;
  if (room.watchdog) { clearInterval(room.watchdog); room.watchdog = null; }

  if (room.teamMode && room.teams) {
    // Team mode: rank teams, then pick the individual winner from winning team
    const ranked = rankedTeams(room);
    const winTeam = ranked[0] ? ranked[0].team : null;
    room.winnerTeamId = winTeam ? winTeam.id : null;
    // Pick the highest-scoring member of the winning team as the "player winner"
    if (winTeam) {
      const members = winTeam.members
        .map((pid) => room.players.find((p) => p.id === pid))
        .filter(Boolean)
        .sort((a, b) => scoreOf(room, b) - scoreOf(room, a));
      room.winnerId = members[0] ? members[0].id : null;
      pushLog(room, `Game over! Team ${winTeam.name} wins with ${ranked[0].score} points! 🏆`);
    }
  } else {
    // Standard mode
    const ranked = rankedPlayers(room);
    const winner = ranked[0] ? ranked[0].p : null;
    room.winnerId = winner ? winner.id : null;
    if (winner) pushLog(room, `Game over! ${winner.name} wins with ${ranked[0].score} points! 🏆`);
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
  // In team mode, only count non-teammates.
  const oppsOnTop = room.players.filter(
    (o) => o.id !== bot.id && o.pos[mi] >= m.height && !areTeammates(room, bot.id, o.id)
  ).length;

  // In team mode: if a teammate is already on this summit, harvesting gives nothing.
  const teammateOnTop = room.teamMode && room.teams
    ? room.players.some((o) => o.id !== bot.id && o.pos[mi] >= m.height && areTeammates(room, bot.id, o.id))
    : false;

  let value;

  if (m.chips <= 0) {
    // Empty mountain: only useful if we can bump someone off the top.
    if (!atTop && stepsLeft === 1 && oppsOnTop > 0) {
      value = 2 * oppsOnTop; // mild reward
    } else {
      return -Infinity; // waste of dice
    }
  } else if (atTop) {
    // Already on top: harvest another token (even if teammate is also on summit).
    value = m.value + bonusValue;
    // Slightly prefer mountains where chips are scarce (closing soon).
    value += Math.max(0, 3 - m.chips);
  } else if (stepsLeft === 1) {
    // This move reaches the top → collect a token + optional bump + optional set.
    // In team mode, reaching summit where teammate is already there still scores.
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
// Broadcast online player count to all connected clients
function broadcastOnlineCount() {
  const count = io.engine.clientsCount;
  io.emit('onlineCount', count);
}

io.on('connection', (socket) => {
  // Send current online count to new client and broadcast to all
  broadcastOnlineCount();
  socket.on('disconnect', () => {
    // Delay slightly so the count reflects the disconnection
    setTimeout(broadcastOnlineCount, 100);
  });

  socket.on('createRoom', ({ name, isPublic, maxPlayers }, cb) => {
    name = (name || '').trim().slice(0, 16);
    if (!name) return cb && cb({ error: 'Please enter your name.' });
    const room = createRoom({ isPublic, maxPlayers });
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
    // Match by name even if still marked connected — this handles the
    // page-refresh race where the new socket arrives before the server
    // fires the disconnect event for the old socket. Works for both
    // lobby and in-game reconnection (e.g. mobile app switch).
    const existing = room.players.find((p) => p.name === name && !p.isBot);

    if (existing) {
      const wasMyTurn = room.players[room.currentIndex] &&
        room.players[room.currentIndex].id === existing.id;
      const wasDisconnected = !existing.connected;
      const oldId = existing.id;
      existing.id = socket.id;
      existing.connected = true;
      // Update team member references when player ID changes on reconnect
      if (room.teams && oldId !== socket.id) {
        room.teams.forEach((t) => {
          const idx = t.members.indexOf(oldId);
          if (idx !== -1) t.members[idx] = socket.id;
        });
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
      if (wasDisconnected) {
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
    if (room.players.length >= room.maxPlayers) return cb && cb({ error: 'Room is full.' });
    if (room.players.some((p) => p.name === name)) {
      return cb && cb({ error: 'Name already taken in this room.' });
    }
    socket.join(room.code);
    const player = addPlayer(room, socket.id, name);
    // Auto-assign to smallest team if team mode is active
    if (room.teamMode && room.teams) {
      const smallest = room.teams.reduce((a, b) => a.members.length <= b.members.length ? a : b);
      smallest.members.push(player.id);
      assignPlayerTeamColor(room, player.id, false);
    }
    pushLog(room, `${name} joined.`);
    cb && cb({ ok: true, code: room.code, youId: player.id });
    broadcast(room);
  });

  socket.on('addBot', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.length >= room.maxPlayers) return;
    const bot = addBot(room);
    if (!bot) return;
    // Auto-assign to smallest team if team mode is active
    if (room.teamMode && room.teams) {
      const smallest = room.teams.reduce((a, b) => a.members.length <= b.members.length ? a : b);
      smallest.members.push(bot.id);
      assignPlayerTeamColor(room, bot.id, false);
    }
    pushLog(room, `${bot.name} was added.`);
    broadcast(room);
  });

  socket.on('setPlayerColor', ({ color, playerId }, cb) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.started) return cb && cb({ error: 'Cannot change colour now.' });
    if (!color || !PLAYER_COLORS.includes(color)) return cb && cb({ error: 'Invalid colour.' });
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
  });

  socket.on('removeBot', ({ id }) => {
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
  });

  // Host kicks any player (human or bot) from the lobby
  socket.on('kickPlayer', ({ id }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (id === socket.id) return; // can't kick yourself
    const idx = room.players.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const [kicked] = room.players.splice(idx, 1);
    // Remove from team membership
    if (room.teams) {
      room.teams.forEach((t) => {
        t.members = t.members.filter((mid) => mid !== id);
      });
    }
    pushLog(room, `${kicked.name} was kicked by the host.`);
    if (room.currentIndex >= room.players.length) room.currentIndex = 0;
    // Notify the kicked player with the host's name
    const hostPlayer = room.players.find((p) => p.id === room.hostId);
    io.to(id).emit('kicked', { hostName: hostPlayer ? hostPlayer.name : 'The host' });
    broadcast(room);
  });

  // ---- Room settings socket events (lobby only) ----

  // Toggle room visibility (public/private)
  socket.on('setRoomVisibility', ({ isPublic }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    room.isPublic = !!isPublic;
    broadcast(room);
  });

  // Set max players for the room
  socket.on('setMaxPlayers', ({ maxPlayers }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    maxPlayers = parseInt(maxPlayers, 10);
    if (maxPlayers < 2 || maxPlayers > MAX_PLAYERS) return;
    if (maxPlayers < room.players.length) return; // can't set below current player count
    room.maxPlayers = maxPlayers;
    broadcast(room);
  });

  // Get list of public rooms (for the join screen)
  socket.on('getPublicRooms', (cb) => {
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
          teamMode: room.teamMode || false,
        });
      }
    }
    cb && cb(publicRooms);
  });

  // ---- Team mode socket events (lobby only) ----

  // Toggle team mode on/off
  socket.on('setTeamMode', ({ enabled }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    room.teamMode = !!enabled;
    if (room.teamMode) {
      // Auto-build teams with default config
      const configs = getValidTeamConfigs(room.players.length);
      if (configs.length > 0) {
        room.teams = buildTeams(room, configs[0].teams);
        assignAllTeamColors(room);
        pushLog(room, `Team mode enabled! (${configs[0].teams} teams of ${configs[0].perTeam})`);
      } else {
        // No valid config for this player count — build 2 teams anyway
        room.teams = buildTeams(room, 2);
        assignAllTeamColors(room);
        pushLog(room, `Team mode enabled! Teams may be uneven.`);
      }
    } else {
      room.teams = null;
      room.winnerTeamId = null;
      pushLog(room, 'Team mode disabled.');
    }
    broadcast(room);
  });

  // Change team configuration (number of teams)
  socket.on('setTeamConfig', ({ numTeams }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started || !room.teamMode) return;
    numTeams = parseInt(numTeams, 10);
    if (numTeams < 2 || numTeams > 3) return;
    room.teams = buildTeams(room, numTeams);
    assignAllTeamColors(room);
    const perTeam = Math.ceil(room.players.length / numTeams);
    pushLog(room, `Teams reconfigured: ${numTeams} teams of ~${perTeam}.`);
    broadcast(room);
  });

  // Move a player to a different team (host only — can move anyone)
  socket.on('swapTeam', ({ playerId, toTeamId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started || !room.teamMode || !room.teams) return;
    toTeamId = parseInt(toTeamId, 10);
    const targetTeam = getTeamById(room, toTeamId);
    if (!targetTeam) return;
    // Verify the player exists in the room
    if (!room.players.some((p) => p.id === playerId)) return;
    // Remove player from current team
    const currentTeam = getTeamOfPlayer(room, playerId);
    if (currentTeam) {
      currentTeam.members = currentTeam.members.filter((id) => id !== playerId);
    }
    // Add to new team
    if (!targetTeam.members.includes(playerId)) {
      targetTeam.members.push(playerId);
    }
    assignPlayerTeamColor(room, playerId, true);
    broadcast(room);
  });

  // Non-host player moves themselves to a different team
  socket.on('selfSwapTeam', ({ toTeamId }) => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.started || !room.teamMode || !room.teams) return;
    // Only allow moving yourself (not others)
    const playerId = socket.id;
    if (!room.players.some((p) => p.id === playerId)) return;
    toTeamId = parseInt(toTeamId, 10);
    const targetTeam = getTeamById(room, toTeamId);
    if (!targetTeam) return;
    // Remove from current team
    const currentTeam = getTeamOfPlayer(room, playerId);
    if (currentTeam && currentTeam.id === toTeamId) return; // already on this team
    if (currentTeam) {
      currentTeam.members = currentTeam.members.filter((id) => id !== playerId);
    }
    // Add to new team
    if (!targetTeam.members.includes(playerId)) {
      targetTeam.members.push(playerId);
    }
    assignPlayerTeamColor(room, playerId, true);
    const player = room.players.find((p) => p.id === playerId);
    if (player) {
      pushLog(room, `${player.name} joined Team ${targetTeam.name}.`);
    }
    broadcast(room);
  });

  socket.on('startGame', () => {
    const room = findRoomBySocket(socket.id);
    if (!room || room.hostId !== socket.id || room.started) return;
    if (room.players.length < 2) return;

    // Validate team mode: ensure every player is in a team and teams are non-empty
    if (room.teamMode && room.teams) {
      // Clean up: ensure all current player IDs are in teams
      const allIds = new Set(room.players.map((p) => p.id));
      // Remove stale IDs
      room.teams.forEach((t) => {
        t.members = t.members.filter((id) => allIds.has(id));
      });
      // Add any unassigned players to the smallest team
      const assigned = new Set(room.teams.flatMap((t) => t.members));
      room.players.forEach((p) => {
        if (!assigned.has(p.id)) {
          const smallest = room.teams.reduce((a, b) => a.members.length <= b.members.length ? a : b);
          smallest.members.push(p.id);
          assignPlayerTeamColor(room, p.id, false);
        }
      });
      // Remove empty teams
      room.teams = room.teams.filter((t) => t.members.length > 0);
      if (room.teams.length < 2) {
        room.teamMode = false;
        room.teams = null;
        pushLog(room, 'Team mode disabled (not enough teams).');
      }
      // Validate equal team sizes
      if (room.teamMode && room.teams) {
        const sizes = room.teams.map((t) => t.members.length);
        if (sizes.some((s) => s !== sizes[0])) {
          // Teams are unequal — block start
          pushLog(room, 'Cannot start: teams must have equal number of players.');
          broadcast(room);
          return;
        }
      }
    }

    if (room.teamMode && room.teams && room.teams.length >= 2) {
      // TEAM MODE: interleave players so turns alternate between teams.
      // 1. Shuffle team order randomly
      const teamsCopy = [...room.teams];
      for (let i = teamsCopy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [teamsCopy[i], teamsCopy[j]] = [teamsCopy[j], teamsCopy[i]];
      }
      // 2. Shuffle members within each team
      const teamMembers = teamsCopy.map((t) => {
        const members = t.members
          .map((pid) => room.players.find((p) => p.id === pid))
          .filter(Boolean);
        // Fisher-Yates shuffle
        for (let i = members.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [members[i], members[j]] = [members[j], members[i]];
        }
        return members;
      });
      // 3. Round-robin interleave: take one player from each team in turn
      const interleaved = [];
      const maxLen = Math.max(...teamMembers.map((m) => m.length));
      for (let slot = 0; slot < maxLen; slot++) {
        for (let t = 0; t < teamMembers.length; t++) {
          if (slot < teamMembers[t].length) {
            interleaved.push(teamMembers[t][slot]);
          }
        }
      }
      // 4. Replace room.players with the interleaved order
      room.players = interleaved;
      // 5. Reorder room.teams to match the shuffled team order used for interleaving
      room.teams = teamsCopy;
    } else {
      // Standard mode: shuffle player order so the host doesn't always go first.
      for (let i = room.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
      }
    }
    resetForNewGame(room);
    room.started = true;
    room.startedAt = Date.now();
    if (room.teamMode && room.teams) {
      const teamNames = room.teams.map((t) => `Team ${t.name}: ${t.members.map((id) => { const p = room.players.find((pl) => pl.id === id); return p ? p.name : '?'; }).join(', ')}`).join(' | ');
      pushLog(room, `The climb begins! 🐐 [Teams: ${teamNames}]`);
    } else {
      pushLog(room, 'The climb begins! 🐐');
    }
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
    room.started = false; // go back to lobby so players can adjust
    room.log = [];
    if (room.watchdog) { clearInterval(room.watchdog); room.watchdog = null; }
    if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
    pushLog(room, 'Back to lobby — start when ready! 🐐');
    broadcast(room);
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
    if (immediate) {
      // Explicit leave: remove immediately.
      room.players = room.players.filter((p) => p.id !== socket.id);
      // Remove from team membership
      if (room.teams) {
        room.teams.forEach((t) => {
          t.members = t.members.filter((mid) => mid !== socket.id);
        });
      }
      pushLog(room, `${player.name} left.`);
      if (room.hostId === socket.id) {
        const nextHost = room.players.find((p) => !p.isBot && p.connected);
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
        delete rooms[room.code];
        return;
      }
      // Schedule cleanup: remove from lobby after 30s if still disconnected.
      player._lobbyCleanup = setTimeout(() => {
        player._lobbyCleanup = null;
        if (!rooms[room.code]) return;
        if (player.connected || room.started) return; // reconnected or game started
        room.players = room.players.filter((p) => p !== player);
        pushLog(room, `${player.name} timed out.`);
        if (room.hostId === player.id) {
          const nextHost = room.players.find((p) => p.connected && !p.isBot);
          room.hostId = nextHost ? nextHost.id : null;
        }
        if (!hasHuman(room)) {
          if (room.botTimer) clearTimeout(room.botTimer);
          if (room.watchdog) clearInterval(room.watchdog);
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
    if (room.hostId === socket.id) {
      const nextHost = room.players.find((p) => p.connected && !p.isBot);
      room.hostId = nextHost ? nextHost.id : room.hostId;
    }
    if (!hasHuman(room)) {
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.watchdog) clearInterval(room.watchdog);
      // The last human left an in-progress game. Record it as abandoned so it
      // still appears in the admin history instead of vanishing silently.
      if (room.started && !room.finished) {
        recordGameHistory(room, { abandoned: true });
      }
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

