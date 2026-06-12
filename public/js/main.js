/* Mountain Goats - client */
(function () {
  const socket = io({
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });

  let myId = null;
  let state = null;
  const selected = new Set(); // selected die indices for the current group
  let selSig = '';
  let autoEndTimer = null; // timer for auto-ending turn when no groups possible

  const screens = {
    loading: document.getElementById('screen-loading'),
    home: document.getElementById('screen-home'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
  };
  const $ = (id) => document.getElementById(id);

  function show(name) {
    Object.values(screens).forEach((s) => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  // If there's a saved session, show the loading screen immediately
  // so the user never sees the home page flash.
  if (localStorage.getItem('mg_code') && localStorage.getItem('mg_name')) {
    show('loading');
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

  // ===================== HOW TO PLAY TOGGLES =====================
  document.querySelectorAll('.rules-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const content = document.getElementById(targetId);
      if (!content) return;
      const isOpen = content.classList.toggle('open');
      btn.classList.toggle('open', isOpen);
    });
  });

  // ===================== HOME =====================
  $('btn-create').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    if (!name) return ($('home-error').textContent = 'Please enter your name.');
    setHomeLoading('create');
    socket.emit('createRoom', { name }, (res) => {
      clearHomeLoading();
      if (res.error) return ($('home-error').textContent = res.error);
      leftRoom = false;
      myId = res.youId;
      localStorage.setItem('mg_name', name);
      localStorage.setItem('mg_code', res.code);
    });
  });
  $('btn-join').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    const code = String($('home-code').value || '').trim().slice(0, 4);
    if (!name) return ($('home-error').textContent = 'Please enter your name.');
    if (!code || code.length < 4) return ($('home-error').textContent = 'Please enter the 4-digit room code.');
    setHomeLoading('join');
    socket.emit('joinRoom', { name, code }, (res) => {
      clearHomeLoading();
      if (res.error) return ($('home-error').textContent = res.error);
      leftRoom = false;
      myId = res.youId;
      localStorage.setItem('mg_name', name);
      localStorage.setItem('mg_code', res.code);
    });
  });

  function setHomeLoading(which) {
    $('btn-create').disabled = true;
    $('btn-join').disabled = true;
    $('home-error').textContent = '';
    if (which === 'create') $('btn-create').innerHTML = '<span class="spin">⏳</span> Creating…';
    else $('btn-join').innerHTML = '<span class="spin">⏳</span> Joining…';
  }
  function clearHomeLoading() {
    $('btn-create').disabled = false;
    $('btn-join').disabled = false;
    $('btn-create').textContent = 'Create Room';
    $('btn-join').textContent = 'Join Room';
  }

  // ===================== LOBBY / NAV =====================
  $('btn-start').addEventListener('click', () => socket.emit('startGame'));
  $('btn-addbot').addEventListener('click', () => socket.emit('addBot'));
  // Team mode controls
  $('btn-teammode').addEventListener('click', () => {
    if (!state) return;
    socket.emit('setTeamMode', { enabled: !state.teamMode });
  });
  $('btn-2teams').addEventListener('click', () => socket.emit('setTeamConfig', { numTeams: 2 }));
  $('btn-3teams').addEventListener('click', () => socket.emit('setTeamConfig', { numTeams: 3 }));

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

  function shareWinResult() {
    if (!state) return;
    const winner = state.players.find((p) => p.id === state.winnerId);
    if (!winner) return;
    const scores = [...state.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => `${p.name}: ${p.score}pts`)
      .join(', ');
    const text = `🐐 Mountain Goats — ${winner.name} wins! ${scores}\nPlay at: ${location.origin}`;
    if (navigator.share) {
      navigator.share({ title: 'Mountain Goats Result', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('Result copied! 📋'));
    } else {
      toast('Winner: ' + winner.name + ' · ' + scores);
    }
  }

  function shareRoom() {
    if (!state) return;
    const text = `Join my Mountain Goats game! Room code: ${state.code} - ${location.origin}`;
    if (navigator.share) navigator.share({ title: 'Mountain Goats', text }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast('Invite copied!'));
    else toast('Room code: ' + state.code);
  }
  let leftRoom = false; // flag to ignore state broadcasts after leaving
  function leaveToHome() {
    leftRoom = true;
    socket.emit('leaveRoom');
    state = null;
    localStorage.removeItem('mg_code');
    localStorage.removeItem('mg_name');
    $('win-overlay').classList.remove('show');
    show('home');
  }

  // ===================== GAME CONTROLS =====================
  $('btn-roll').addEventListener('click', () => {
    socket.emit('rollDice');
    $('dice-area').classList.add('rolling');
    setTimeout(() => $('dice-area').classList.remove('rolling'), 500);
  });
  $('btn-endturn').addEventListener('click', () => {
    if (isMyTurn() && state.rolled && anyGroupPossible()) {
      // Show confirmation popup if there are still valid groups
      $('endturn-overlay').classList.add('show');
    } else {
      socket.emit('endTurn');
    }
  });
  $('btn-endturn-confirm').addEventListener('click', () => {
    $('endturn-overlay').classList.remove('show');
    socket.emit('endTurn');
  });
  $('btn-endturn-cancel').addEventListener('click', () => {
    $('endturn-overlay').classList.remove('show');
  });
  $('btn-playagain').addEventListener('click', () => {
    $('win-overlay').classList.remove('show'); // close immediately
    socket.emit('playAgain');
  });
  $('btn-home').addEventListener('click', () => {
    $('win-overlay').classList.remove('show');
    leaveToHome();
  });
  $('btn-win-share').addEventListener('click', shareWinResult);

  // ===================== SOCKET =====================
  socket.on('connect', () => {
    const code = localStorage.getItem('mg_code');
    const name = localStorage.getItem('mg_name');
    if (code && name) {
      leftRoom = false;
      socket.emit('joinRoom', { name, code }, (res) => {
        if (res && res.ok) {
          myId = res.youId;
        } else {
          localStorage.removeItem('mg_code');
          localStorage.removeItem('mg_name');
          show('home');
        }
      });
    } else {
      show('home');
    }
  });

  // Track consecutive connection failures — only give up after several.
  let connectErrors = 0;
  socket.on('connect_error', () => {
    connectErrors++;
    if (screens.loading.classList.contains('active') && connectErrors >= 5) {
      localStorage.removeItem('mg_code');
      localStorage.removeItem('mg_name');
      show('home');
    }
  });
  socket.on('connect', () => { connectErrors = 0; });
  socket.on('state', (s) => {
    if (leftRoom) return; // ignore stale broadcasts after leaving
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

    if (state.teamMode && state.teams) {
      // Team mode: render players grouped by team
      state.teams.forEach((team) => {
        const teamHeader = document.createElement('li');
        teamHeader.className = 'team-header';
        teamHeader.innerHTML = `<span class="team-dot" style="background:${team.color}"></span>
          <span class="team-label">Team ${escapeHtml(team.name)}</span>
          <span class="team-count">${team.members.length} player${team.members.length !== 1 ? 's' : ''}</span>`;
        ul.appendChild(teamHeader);

        team.members.forEach((pid) => {
          const p = state.players.find((pl) => pl.id === pid);
          if (!p) return;
          const li = document.createElement('li');
          li.className = 'team-member';
          li.style.setProperty('--team-color', team.color);
          li.innerHTML = `<span class="swatch" style="background:${p.color}"></span>
            <span class="player-name">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>`;
          if (p.id === state.hostId) li.innerHTML += `<span class="badge">HOST</span>`;
          else if (p.id === myId) li.innerHTML += `<span class="badge you">YOU</span>`;
          else if (p.isBot) li.innerHTML += `<span class="badge bot">BOT</span>`;
          // Team swap buttons:
          // - Host can swap ANY player (including themselves)
          // - Non-host can only swap THEMSELVES
          const canSwap = state.teams.length > 1 && (amHost || p.id === myId);
          if (canSwap) {
            const swapWrap = document.createElement('span');
            swapWrap.className = 'team-swap';
            state.teams.forEach((otherTeam) => {
              if (otherTeam.id === team.id) return;
              const btn = document.createElement('button');
              btn.className = 'team-swap-btn';
              btn.style.background = otherTeam.color;
              btn.title = `Move to Team ${otherTeam.name}`;
              btn.textContent = otherTeam.name.charAt(0);
              btn.addEventListener('click', () => {
                if (amHost) {
                  // Host uses swapTeam (can move anyone)
                  socket.emit('swapTeam', { playerId: p.id, toTeamId: otherTeam.id });
                } else {
                  // Non-host uses selfSwapTeam (can only move self)
                  socket.emit('selfSwapTeam', { toTeamId: otherTeam.id });
                }
              });
              swapWrap.appendChild(btn);
            });
            li.appendChild(swapWrap);
          }
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
      });
      // Show any unassigned players with swap controls
      const assigned = new Set(state.teams.flatMap((t) => t.members));
      const unassigned = state.players.filter((p) => !assigned.has(p.id));
      if (unassigned.length) {
        const unHeader = document.createElement('li');
        unHeader.className = 'team-header';
        unHeader.innerHTML = `<span class="team-dot" style="background:#666"></span>
          <span class="team-label">Unassigned</span>
          <span class="team-count">${unassigned.length} player${unassigned.length !== 1 ? 's' : ''}</span>`;
        ul.appendChild(unHeader);
      }
      unassigned.forEach((p) => {
        const li = document.createElement('li');
        li.className = 'team-member';
        li.style.setProperty('--team-color', '#666');
        li.innerHTML = `<span class="swatch" style="background:${p.color}"></span>
          <span class="player-name">${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
          <span class="badge">UNASSIGNED</span>`;
        // Swap buttons: host can assign anyone, non-host only self
        const canSwap = amHost || p.id === myId;
        if (canSwap && state.teams.length > 0) {
          const swapWrap = document.createElement('span');
          swapWrap.className = 'team-swap';
          state.teams.forEach((team) => {
            const btn = document.createElement('button');
            btn.className = 'team-swap-btn';
            btn.style.background = team.color;
            btn.title = `Assign to Team ${team.name}`;
            btn.textContent = team.name.charAt(0);
            btn.addEventListener('click', () => {
              if (amHost) {
                socket.emit('swapTeam', { playerId: p.id, toTeamId: team.id });
              } else {
                socket.emit('selfSwapTeam', { toTeamId: team.id });
              }
            });
            swapWrap.appendChild(btn);
          });
          li.appendChild(swapWrap);
        }
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
    } else {
      // Standard mode: render flat player list
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
    }

    // Team mode toggle (host only)
    const teamSection = $('team-controls');
    if (teamSection) {
      if (amHost) {
        teamSection.style.display = 'block';
        const toggleBtn = $('btn-teammode');
        toggleBtn.textContent = state.teamMode ? '🏁 Disable Teams' : '👥 Enable Teams';
        toggleBtn.className = state.teamMode ? 'btn btn-ghost btn-block team-active' : 'btn btn-ghost btn-block';
        // Team config selector
        const configWrap = $('team-config-wrap');
        if (state.teamMode && state.teams) {
          configWrap.style.display = 'flex';
          const numTeams = state.teams.length;
          $('btn-2teams').classList.toggle('active', numTeams === 2);
          $('btn-3teams').classList.toggle('active', numTeams === 3);
          // Only show 3-team option if 6 players
          $('btn-3teams').style.display = state.players.length >= 6 ? 'inline-block' : 'none';
        } else {
          configWrap.style.display = 'none';
        }
      } else {
        teamSection.style.display = state.teamMode ? 'block' : 'none';
        if (state.teamMode) {
          // Non-host sees team info but no controls
          $('btn-teammode').style.display = 'none';
          $('team-config-wrap').style.display = 'none';
        }
      }
    }

    const startBtn = $('btn-start');
    const addBtn = $('btn-addbot');
    startBtn.style.display = amHost ? 'block' : 'none';
    addBtn.style.display = amHost ? 'block' : 'none';
    addBtn.disabled = state.players.length >= 6;

    // Check if teams are equal (required to start in team mode)
    let teamsUnequal = false;
    if (state.teamMode && state.teams && state.teams.length >= 2) {
      const sizes = state.teams.map((t) => t.members.length);
      teamsUnequal = sizes.some((s) => s !== sizes[0]) || sizes.some((s) => s === 0);
    }

    startBtn.disabled = state.players.length < 2 || teamsUnequal;
    if (amHost) {
      if (state.players.length < 2) {
        $('lobby-hint').textContent = 'Add a bot or wait for a friend to join.';
      } else if (teamsUnequal) {
        const sizes = state.teams.map((t) => `${t.name}: ${t.members.length}`).join(', ');
        $('lobby-hint').textContent = `⚠️ Teams must be equal to start! (${sizes})`;
        $('lobby-hint').style.color = 'var(--danger)';
      } else {
        $('lobby-hint').textContent = state.teamMode ? 'Teams ready! Start when you are!' : 'Ready when you are!';
        $('lobby-hint').style.color = '';
      }
    } else {
      $('lobby-hint').textContent = 'Waiting for the host to start…';
      $('lobby-hint').style.color = '';
    }
  }

  function renderGame() {
    try { $('game-code').textContent = state.code; } catch(e) {}
    syncSelection();
    try { renderTurnBanner(); } catch(e) { console.error('renderTurnBanner', e); }
    try { renderStats(); } catch(e) { console.error('renderStats', e); }
    try { renderBonusRow(); } catch(e) { console.error('renderBonusRow', e); }
    try { renderBoard(); } catch(e) { console.error('renderBoard', e); }
    try { renderDice(); } catch(e) { console.error('renderDice', e); }
    try { renderControls(); } catch(e) { console.error('renderControls', e); }
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
    if (isMyTurn()) {
      banner.textContent = finalTag + '🎯 Your turn!';
      banner.classList.add('my-turn');
      banner.classList.remove('final');
    } else if (!cur.connected && !cur.isBot) {
      banner.textContent = `${finalTag}🤖 Auto-playing for ${cur.name}…`;
      banner.classList.remove('my-turn');
      banner.classList.toggle('final', !!state.lastRound);
    } else {
      banner.textContent = `${finalTag}${cur.name}${cur.isBot ? ' 🤖' : ''}'s turn`;
      banner.classList.remove('my-turn');
      banner.classList.toggle('final', !!state.lastRound);
    }
  }

  function renderStats() {
    const strip = $('stats-strip');
    strip.innerHTML = '';

    // Team score bar (only in team mode)
    if (state.teamMode && state.teams) {
      const teamBar = document.createElement('div');
      teamBar.className = 'team-score-bar';
      const teamLead = Math.max(0, ...state.teams.map((t) => t.score || 0));
      state.teams.forEach((t) => {
        const isLead = t.score === teamLead && teamLead > 0;
        teamBar.innerHTML += `<span class="team-score-pill" style="--tc:${t.color}">
          <span class="tsp-dot" style="background:${t.color}"></span>
          Team ${escapeHtml(t.name)}
          <b>${isLead ? '▲ ' : ''}${t.score || 0}</b>
          <span class="tsp-tops">👑${t.tops || 0}</span>
        </span>`;
      });
      strip.appendChild(teamBar);
    }

    const lead = Math.max(0, ...state.players.map((p) => p.score || 0));
    state.players.forEach((p, idx) => {
      const panel = document.createElement('div');
      const teamClass = (state.teamMode && p.teamId != null) ? ' team-tagged' : '';
      panel.className = 'pp' + (idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off') + teamClass;
      // Add team color border in team mode
      if (state.teamMode && state.teams && p.teamId != null) {
        const pTeam = state.teams.find((t) => t.id === p.teamId);
        if (pTeam) panel.style.setProperty('--team-border', pTeam.color);
      }
      const pos = p.pos || [];
      const collected = p.collected || [];
      let chips = '';
      state.mountains.forEach((m, mi) => {
        const onTop = (pos[mi] || 0) >= m.height;
        const n = collected[mi] || 0;
        chips += `<span class="pp-chip${n > 0 ? ' has' : ''}${onTop ? ' top' : ''}" style="--c:${m.color}">${m.value}<b>×${n}</b></span>`;
      });
      const leadTag = (p.score || 0) === lead && lead > 0 ? '<span class="pp-lead">▲</span>' : '';
      const topsTag = (p.tops || 0) > 0 ? `<span class="pp-tops">👑${p.tops}</span>` : '';
      const bonusTag = p.bonus && p.bonus.length ? `<span class="pp-bonus">✨${p.bonusPoints || 0}</span>` : '';
      const setsTag = (p.sets || 0) > 0 ? `<span class="pp-sets">📦${p.sets}</span>` : '';
      const offTag = !p.connected && !p.isBot ? '<span class="pp-auto">🤖 auto</span>' : '';
      // Team tag
      let teamTag = '';
      if (state.teamMode && state.teams && p.teamId != null) {
        const pTeam = state.teams.find((t) => t.id === p.teamId);
        if (pTeam) teamTag = `<span class="pp-team" style="color:${pTeam.color}">${pTeam.name}</span>`;
      }
      panel.innerHTML = `
        <div class="pp-head">
          <span class="pp-dot" style="background:${p.color}"></span>
          <span class="pp-name">${escapeHtml(p.name)}${p.id === myId ? ' (You)' : ''}</span>
          ${teamTag}${offTag}${setsTag}${topsTag}${bonusTag}<span class="pp-score">${leadTag}⭐ ${p.score || 0}</span>
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
        const wrap = document.createElement('div');
        wrap.className = 'cell-wrap';
        const cell = document.createElement('div');
        cell.className = 'cell' + (p === m.height ? ' top' : '');
        cell.style.setProperty('--c', m.color);
        cell.innerHTML = `<span class="cnum">${m.value}</span>`;
        const here = state.players.filter((pl) => (pl.pos || [])[mi] === p);
        if (here.length) cell.appendChild(goatCluster(here));
        wrap.appendChild(cell);
        track.appendChild(wrap);
      }
      col.appendChild(track);

      // foot (pos 0)
      const foot = document.createElement('div');
      foot.className = 'foot';
      const footGoats = state.players.filter((pl) => (pl.pos || [])[mi] === 0);
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
      // In team mode, add team-colored ring
      if (state.teamMode && state.teams && p.teamId != null) {
        const pTeam = state.teams.find((t) => t.id === p.teamId);
        if (pTeam) g.style.boxShadow = `0 2px 5px rgba(0,0,0,0.45), inset 0 0 0 1.5px rgba(255,255,255,0.6), 0 0 0 2px ${pTeam.color}`;
      }
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
    else if (!anyGroupPossible()) {
      // Auto-end turn after 2 seconds when no valid groups remain
      if (!autoEndTimer) {
        hint.textContent = 'No groups make 5–10 — ending turn in 2s…';
        hint.classList.add('auto-end');
        autoEndTimer = setTimeout(() => {
          autoEndTimer = null;
          hint.classList.remove('auto-end');
          if (isMyTurn() && state.rolled && !anyGroupPossible()) {
            socket.emit('endTurn');
          }
        }, 2000);
      }
    } else {
      // Valid groups exist — cancel any pending auto-end
      if (autoEndTimer) {
        clearTimeout(autoEndTimer);
        autoEndTimer = null;
        hint.classList.remove('auto-end');
      }
      if (!selected.size) hint.textContent = 'Tap dice to group them (sum 5–10), then tap that mountain.';
      else hint.textContent = tMi >= 0 ? 'Tap the glowing mountain to climb 🐐' : 'This group is not 5–10. Adjust your selection.';
    }
  }

  function endReasonBadge(reason) {
    if (!reason) return '';
    if (reason === 'bonus') {
      return `<div class="end-reason">
        <span class="er-icon">✨</span>
        <span>All 4 Bonus Tokens were claimed — the final round was triggered.</span>
      </div>`;
    }
    // 'empty'
    return `<div class="end-reason">
      <span class="er-icon">🏔️</span>
      <span>3 mountains ran out of Point Tokens — the final round was triggered.</span>
    </div>`;
  }

  function showWin() {
    const winner = state.players.find((p) => p.id === state.winnerId);
    if (!winner) return;

    if (state.teamMode && state.teams && state.winnerTeamId != null) {
      // Team mode win screen
      const winTeam = state.teams.find((t) => t.id === state.winnerTeamId);
      if (!winTeam) return;
      // Check if I'm on the winning team
      const myTeam = state.teams.find((t) => t.members.includes(myId));
      const myTeamWon = myTeam && myTeam.id === winTeam.id;
      $('win-title').textContent = myTeamWon ? 'Your Team Wins! 🎉' : `Team ${winTeam.name} Wins!`;

      // Team scoreboard
      const sortedTeams = [...state.teams].sort((a, b) => (b.score || 0) - (a.score || 0) || (b.tops || 0) - (a.tops || 0));
      const teamRows = sortedTeams.map((t, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
        const isWin = t.id === winTeam.id;
        const members = t.members.map((pid) => {
          const pl = state.players.find((p) => p.id === pid);
          return pl ? escapeHtml(pl.name) : '?';
        }).join(', ');
        return `<div class="score-row${isWin ? ' win' : ''}" style="border-left:3px solid ${t.color}">
          <span class="sb-left">${medal} <b style="color:${t.color}">Team ${escapeHtml(t.name)}</b> <span class="sb-members">(${members})</span></span>
          <span class="sb-right">${t.score || 0} pts · 👑${t.tops || 0}</span>
        </div>`;
      }).join('');

      // Individual player breakdown
      const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
      const playerRows = sorted.map((p) => {
        const pTeam = state.teams.find((t) => t.id === p.teamId);
        const teamDot = pTeam ? `<span class="sb-tdot" style="background:${pTeam.color}"></span>` : '';
        const bonusTag = p.bonus && p.bonus.length ? ` <span class="sb-bonus">✨+${p.bonusPoints}</span>` : '';
        return `<div class="score-row score-row-sm">
          <span class="sb-left">${teamDot}${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${bonusTag}</span>
          <span class="sb-right">${p.score} pts · 👑${p.tops}</span>
        </div>`;
      }).join('');

      $('win-sub').innerHTML = `<div class="scoreboard">${teamRows}</div>
        <div class="team-breakdown-label">Individual Scores</div>
        <div class="scoreboard scoreboard-sm">${playerRows}</div>
        ${endReasonBadge(state.endReason)}`;
    } else {
      // Standard mode win screen
      $('win-title').textContent = winner.id === myId ? 'You Win! 🎉' : `${winner.name} Wins!`;
      const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
      const rows = sorted.map((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•';
        const bonusTag = p.bonus && p.bonus.length ? ` <span class="sb-bonus">✨+${p.bonusPoints}</span>` : '';
        return `<div class="score-row${p.id === winner.id ? ' win' : ''}">
          <span class="sb-left">${medal} ${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${bonusTag}</span>
          <span class="sb-right">${p.score} pts · 👑${p.tops}</span>
        </div>`;
      }).join('');

      // Only show tie-break note if it actually mattered.
      const topScore = winner.score;
      const tied = state.players.filter(p => p.score === topScore);
      let tieNote = '';
      if (tied.length > 1) {
        const topTops = winner.tops;
        const tiedOnTops = tied.filter(p => p.tops === topTops);
        if (tiedOnTops.length > 1) {
          tieNote = '<div class="tiebreak">🏔️ Tie broken by goat on the higher-numbered mountain.</div>';
        } else {
          tieNote = '<div class="tiebreak">👑 Tie broken by most goats on mountain tops.</div>';
        }
      }

      $('win-sub').innerHTML = `<div class="scoreboard">${rows}</div>
        ${tieNote}
        ${endReasonBadge(state.endReason)}`;
    }
    $('btn-playagain').style.display = state.hostId === myId ? 'block' : 'none';
    $('win-overlay').classList.add('show');
  }
})();





