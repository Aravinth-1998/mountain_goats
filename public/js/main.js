/* Mountain Goats - client */
(function () {
  const socket = io();

  let myId = null;
  let state = null;
  const selected = new Set(); // selected die indices for the current group
  let selSig = '';

  const screens = {
    home: document.getElementById('screen-home'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
  };
  const $ = (id) => document.getElementById(id);

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ===================== HOME =====================
  $('btn-create').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    if (!name) return ($('home-error').textContent = 'Please enter your name.');
    socket.emit('createRoom', { name }, (res) => {
      if (res.error) return ($('home-error').textContent = res.error);
      myId = res.youId;
      sessionStorage.setItem('mg_name', name);
      sessionStorage.setItem('mg_code', res.code);
    });
  });
  $('btn-join').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    const code = $('home-code').value.trim().toUpperCase();
    if (!name) return ($('home-error').textContent = 'Please enter your name.');
    if (!code) return ($('home-error').textContent = 'Please enter a room code.');
    socket.emit('joinRoom', { name, code }, (res) => {
      if (res.error) return ($('home-error').textContent = res.error);
      myId = res.youId;
      sessionStorage.setItem('mg_name', name);
      sessionStorage.setItem('mg_code', res.code);
    });
  });

  // ===================== LOBBY / NAV =====================
  $('btn-start').addEventListener('click', () => socket.emit('startGame'));
  $('btn-addbot').addEventListener('click', () => socket.emit('addBot'));

  // Leave buttons open the confirm popup
  $('lobby-leave').addEventListener('click', () => askLeave(false));
  $('game-leave').addEventListener('click', () => askLeave(true));

  // Room code copy on tap
  $('lobby-pill').addEventListener('click', copyRoomCode);
  $('lobby-share').addEventListener('click', shareRoom);

  // Leave confirm popup
  $('btn-leave-cancel').addEventListener('click', () => $('leave-overlay').classList.remove('show'));
  $('btn-leave-confirm').addEventListener('click', () => {
    $('leave-overlay').classList.remove('show');
    leaveToHome();
  });

  function askLeave(inGame) {
    $('leave-msg').textContent = inGame
      ? 'Your goats will stay put, but your turn will be skipped.'
      : 'You will leave the lobby.';
    $('leave-overlay').classList.add('show');
  }

  function copyRoomCode() {
    if (!state) return;
    const code = state.code;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(code).then(() => toast(`Room code ${code} copied!`));
    } else {
      toast('Room code: ' + code);
    }
  }

  function shareRoom() {
    if (!state) return;
    const text = `Join my Mountain Goats game! Room code: ${state.code} - ${location.origin}`;
    if (navigator.share) navigator.share({ title: 'Mountain Goats', text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Invite copied!'));
    else toast('Room code: ' + state.code);
  }
  function leaveToHome() {
    socket.emit('leaveRoom');
    state = null;
    sessionStorage.removeItem('mg_code');
    show('home');
  }

  // ===================== GAME CONTROLS =====================
  $('btn-roll').addEventListener('click', () => {
    socket.emit('rollDice');
    $('dice-area').classList.add('rolling');
    setTimeout(() => $('dice-area').classList.remove('rolling'), 500);
  });
  $('btn-endturn').addEventListener('click', () => socket.emit('endTurn'));
  $('btn-playagain').addEventListener('click', () => socket.emit('playAgain'));
  $('btn-home').addEventListener('click', () => {
    $('win-overlay').classList.remove('show');
    leaveToHome();
  });

  // ===================== SOCKET =====================
  socket.on('connect', () => {
    const code = sessionStorage.getItem('mg_code');
    const name = sessionStorage.getItem('mg_name');
    if (code && name && !state) {
      socket.emit('joinRoom', { name, code }, (res) => {
        if (res && res.ok) myId = res.youId;
        else sessionStorage.removeItem('mg_code');
      });
    }
  });
  socket.on('state', (s) => {
    const wasFinished = state && state.finished;
    state = s;
    if (s && !s.finished) $('win-overlay').classList.remove('show');
    render();
    if (s.finished && !wasFinished) showWin();
  });

  // ===================== HELPERS =====================
  function me() {
    return state ? state.players.find((p) => p.id === myId) : null;
  }
  function isMyTurn() {
    return state && state.currentPlayerId === myId && state.started && !state.finished;
  }

  function selectedSum() {
    let s = 0;
    selected.forEach((i) => (s += state.dice[i]));
    return s;
  }
  function targetMountain() {
    if (!selected.size) return -1;
    const sum = selectedSum();
    return state.mountains.findIndex((m) => m.value === sum);
  }
  // can any subset of unused dice reach a value 5-10?
  function anyGroupPossible() {
    if (!state.dice) return false;
    const idx = state.dice.map((_, i) => i).filter((i) => !state.diceUsed[i]);
    const n = idx.length;
    for (let mask = 1; mask < (1 << n); mask++) {
      let sum = 0;
      for (let b = 0; b < n; b++) if (mask & (1 << b)) sum += state.dice[idx[b]];
      if (sum >= 5 && sum <= 10) return true;
    }
    return false;
  }

  // ===================== RENDER =====================
  function render() {
    if (!state) return;
    if (!state.started) {
      show('lobby');
      renderLobby();
    } else {
      show('game');
      renderGame();
    }
  }

  function renderLobby() {
    $('lobby-code').textContent = state.code;
    const amHost = state.hostId === myId;
    const ul = $('lobby-players');
    ul.innerHTML = '';
    state.players.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="swatch" style="background:${p.color}"></span>
        <span class="player-name">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>`;
      if (p.id === state.hostId) li.innerHTML += `<span class="badge">HOST</span>`;
      else if (p.id === myId) li.innerHTML += `<span class="badge you">YOU</span>`;
      else if (p.isBot) li.innerHTML += `<span class="badge bot">BOT</span>`;
      if (amHost && p.isBot) {
        const x = document.createElement('button');
        x.className = 'kick-btn';
        x.textContent = '✕';
        x.title = 'Remove bot';
        x.addEventListener('click', () => socket.emit('removeBot', { id: p.id }));
        li.appendChild(x);
      }
      ul.appendChild(li);
    });

    const startBtn = $('btn-start');
    const addBtn = $('btn-addbot');
    startBtn.style.display = amHost ? 'block' : 'none';
    startBtn.disabled = state.players.length < 2;
    addBtn.style.display = amHost ? 'block' : 'none';
    addBtn.disabled = state.players.length >= 6;
    $('lobby-hint').textContent = amHost
      ? state.players.length < 2 ? 'Add a bot or wait for a friend to join.' : 'Ready when you are!'
      : 'Waiting for the host to start…';
  }

  function renderGame() {
    $('game-code').textContent = state.code;
    syncSelection();
    renderTurnBanner();
    renderStats();
    renderBonusRow();
    renderBoard();
    renderDice();
    renderControls();
  }

  function syncSelection() {
    const sig = state.currentPlayerId + '|' + state.rolled;
    if (sig !== selSig) {
      selected.clear();
      selSig = sig;
    }
    [...selected].forEach((i) => {
      if (!state.dice || i >= state.dice.length || state.diceUsed[i]) selected.delete(i);
    });
    if (!isMyTurn() || !state.rolled) selected.clear();
  }

  function renderTurnBanner() {
    const banner = $('turn-banner');
    const cur = state.players[state.currentIndex];
    if (!cur) { banner.textContent = '—'; return; }
    const finalTag = state.lastRound ? '🔔 Final · ' : '';
    banner.textContent = isMyTurn() ? finalTag + '🎯 Your turn!' : `${finalTag}${cur.name}'s turn`;
    banner.classList.toggle('my-turn', isMyTurn());
    banner.classList.toggle('final', !!state.lastRound);
  }

  function renderStats() {
    const strip = $('stats-strip');
    strip.innerHTML = '';
    const lead = Math.max(0, ...state.players.map((p) => p.score));
    state.players.forEach((p, idx) => {
      const panel = document.createElement('div');
      panel.className = 'pp' + (idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off');
      let chips = '';
      state.mountains.forEach((m, mi) => {
        const n = p.collected[mi] || 0;
        const onTop = p.pos[mi] >= m.height;
        chips += `<span class="pp-chip${n > 0 ? ' has' : ''}${onTop ? ' top' : ''}" style="--c:${m.color}">${m.value}<b>×${n}</b></span>`;
      });
      const leadTag = p.score === lead && lead > 0 ? '<span class="pp-lead">▲</span>' : '';
      const topsTag = p.tops > 0 ? `<span class="pp-tops">👑${p.tops}</span>` : '';
      const bonusTag = p.bonus && p.bonus.length ? `<span class="pp-bonus">✨${p.bonusPoints}</span>` : '';
      const setsTag = p.sets > 0 ? `<span class="pp-sets">📦${p.sets}</span>` : '';
      panel.innerHTML = `
        <div class="pp-head">
          <span class="pp-dot" style="background:${p.color}"></span>
          <span class="pp-name">${escapeHtml(p.name)}${p.id === myId ? ' (You)' : ''}</span>
          ${setsTag}${topsTag}${bonusTag}<span class="pp-score">${leadTag}⭐ ${p.score}</span>
        </div>
        <div class="pp-mtns">${chips}</div>`;
      strip.appendChild(panel);
    });
  }

  function renderBonusRow() {
    const row = $('bonus-row');
    if (!row) return;
    const all = [15, 12, 9, 6];
    const remaining = state.bonusTokens || [];
    row.innerHTML = '<span class="bonus-label">Bonus</span>' + all
      .map((v) => `<span class="bonus-tok${remaining.includes(v) ? '' : ' gone'}">✨${v}</span>`)
      .join('');
  }

  function renderBoard() {
    const board = $('board');
    board.innerHTML = '';
    const tMi = targetMountain();

    state.mountains.forEach((m, mi) => {
      const col = document.createElement('div');
      col.className = 'mcol';
      const isTarget = isMyTurn() && state.rolled && mi === tMi;
      if (isTarget) col.classList.add('target');

      // tooltip-ish header: tokens remaining
      const head = document.createElement('div');
      head.className = 'mhead';
      head.innerHTML = `<span class="mtok" style="--c:${m.color}">${m.value}</span>
        <span class="mleft">${m.chips > 0 ? '×' + m.chips : 'closed'}</span>`;
      col.appendChild(head);

      // climbing track: top space (pos=height) down to bottom (pos=1)
      const track = document.createElement('div');
      track.className = 'track';
      for (let p = m.height; p >= 1; p--) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (p === m.height ? ' top' : '');
        cell.style.setProperty('--c', m.color);
        cell.innerHTML = `<span class="cnum">${m.value}</span>`;
        const here = state.players.filter((pl) => pl.pos[mi] === p);
        if (here.length) cell.appendChild(goatCluster(here));
        track.appendChild(cell);
      }
      col.appendChild(track);

      // foot (pos 0)
      const foot = document.createElement('div');
      foot.className = 'foot';
      const footGoats = state.players.filter((pl) => pl.pos[mi] === 0);
      if (footGoats.length) foot.appendChild(goatCluster(footGoats));
      col.appendChild(foot);

      if (isTarget) {
        col.addEventListener('click', () => {
          socket.emit('moveGroup', { indices: [...selected], mountainIndex: mi });
          selected.clear();
        });
      }
      board.appendChild(col);
    });
  }

  function goatCluster(players) {
    const wrap = document.createElement('div');
    wrap.className = 'goats';
    players.forEach((p) => {
      const g = document.createElement('div');
      g.className = 'goat' + (p.id === myId ? ' me' : '');
      g.style.background = p.color;
      g.textContent = p.name.charAt(0).toUpperCase();
      g.title = p.name;
      wrap.appendChild(g);
    });
    return wrap;
  }

  function renderDice() {
    const area = $('dice-area');
    area.innerHTML = '';
    const mine = isMyTurn();
    if (!state.rolled || !state.dice) {
      for (let i = 0; i < (state.numDice || 4); i++) {
        const d = document.createElement('div');
        d.className = 'die';
        d.textContent = '🎲';
        area.appendChild(d);
      }
      return;
    }
    const noneUsed = !state.diceUsed.some((u) => u);
    state.dice.forEach((v, i) => {
      const d = document.createElement('div');
      d.className = 'die'
        + (state.diceUsed[i] ? ' used' : '')
        + (selected.has(i) ? ' sel' : '');
      d.textContent = v;
      if (mine && !state.diceUsed[i]) {
        d.addEventListener('click', () => {
          if (selected.has(i)) selected.delete(i); else selected.add(i);
          renderGame();
        });
      }
      // 1s re-face control
      if (mine && noneUsed && state.adjustable && state.adjustable.includes(i)) {
        const btn = document.createElement('button');
        btn.className = 'reface';
        btn.textContent = '↻';
        btn.title = 'Change this 1 to any face';
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          socket.emit('adjustDie', { index: i, value: (v % 6) + 1 });
        });
        d.appendChild(btn);
      }
      area.appendChild(d);
    });
  }

  function renderControls() {
    const mine = isMyTurn();
    $('btn-roll').disabled = !mine || state.rolled;
    $('btn-endturn').disabled = !mine || !state.rolled;

    const sumEl = $('sel-sum');
    const sum = selectedSum();
    const tMi = targetMountain();
    if (mine && state.rolled && selected.size) {
      sumEl.textContent = tMi >= 0 ? `Group = ${sum} → tap Mountain ${sum}` : `Group = ${sum} (no mountain)`;
      sumEl.classList.toggle('ok', tMi >= 0);
    } else {
      sumEl.textContent = '';
      sumEl.classList.remove('ok');
    }

    const hint = $('game-hint');
    if (state.finished) hint.textContent = 'Game over.';
    else if (!mine) {
      const cur = state.players[state.currentIndex];
      hint.textContent = cur ? `Waiting for ${cur.name}…` : '';
    } else if (!state.rolled) hint.textContent = 'Tap "Roll Dice" to roll 4 dice.';
    else if (!anyGroupPossible()) hint.textContent = 'No groups make 5–10 — tap "End Turn".';
    else if (!selected.size) hint.textContent = 'Tap dice to group them (sum 5–10), then tap that mountain.';
    else hint.textContent = tMi >= 0 ? 'Tap the glowing mountain to climb 🐐' : 'This group is not 5–10. Adjust your selection.';
  }

  function showWin() {
    const winner = state.players.find((p) => p.id === state.winnerId);
    if (!winner) return;
    $('win-title').textContent = winner.id === myId ? 'You Win! 🎉' : `${winner.name} Wins!`;
    const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
    const rows = sorted.map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
      const bonus = p.bonus && p.bonus.length ? ` · ✨${p.bonusPoints}` : '';
      return `<div class="score-row${p.id === winner.id ? ' win' : ''}">
        <span>${medal} ${escapeHtml(p.name)}</span>
        <span>${p.score} pts · 👑${p.tops}${bonus}</span></div>`;
    }).join('');
    $('win-sub').innerHTML = `<div class="scoreboard">${rows}</div>
      <div class="tiebreak">Ties: most goats on tops, then a goat on the higher mountain.</div>`;
    $('btn-playagain').style.display = state.hostId === myId ? 'block' : 'none';
    $('win-overlay').classList.add('show');
  }
})();

