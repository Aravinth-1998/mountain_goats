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
    join: document.getElementById('screen-join'),
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
  function playerCoinHtml(p, sizeClass) {
    const cls = 'swatch' + (sizeClass ? ' ' + sizeClass : '') + (p.id === myId ? ' me' : '');
    return `<span class="${cls}" style="background:${p.color}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>`;
  }

  // Enforce 4-digit limit on room code inputs
  $('join-code').addEventListener('input', function() {
    if (this.value.length > 4) this.value = this.value.slice(0, 4);
  });

  // Public rooms refresh timer
  let publicRoomsTimer = null;

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

  // Clear error styling when user clicks or types in the name field
  $('home-name').addEventListener('focus', () => {
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
  });
  $('home-name').addEventListener('input', () => {
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
  });

  // ===================== HOME =====================
  $('btn-create').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    if (!name) {
      $('home-name').classList.add('input-error');
      return ($('home-name-error').textContent = 'Please enter your name.');
    }
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
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

  // Navigate to Join screen
  $('btn-goto-join').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    if (!name) {
      $('home-name').classList.add('input-error');
      return ($('home-name-error').textContent = 'Please enter your name.');
    }
    $('home-name').classList.remove('input-error');
    $('home-name-error').textContent = '';
    $('home-error').textContent = '';
    show('join');
    refreshPublicRooms();
    startPublicRoomsRefresh();
  });

  // Join screen back button
  $('join-back').addEventListener('click', () => {
    stopPublicRoomsRefresh();
    show('home');
  });

  // Join Room (from join screen)
  $('btn-join').addEventListener('click', () => {
    const name = $('home-name').value.trim();
    const code = String($('join-code').value || '').trim().slice(0, 4);
    if (!name) return ($('join-error').textContent = 'Please enter your name on the home screen.');
    if (!code || code.length < 4) return ($('join-error').textContent = 'Please enter the 4-digit room code.');
    $('join-error').textContent = '';
    $('btn-join').disabled = true;
    $('btn-join').innerHTML = '<span class="spin">⏳</span> Joining…';
    socket.emit('joinRoom', { name, code }, (res) => {
      $('btn-join').disabled = false;
      $('btn-join').textContent = 'Join Room';
      if (res.error) return ($('join-error').textContent = res.error);
      leftRoom = false;
      myId = res.youId;
      localStorage.setItem('mg_name', name);
      localStorage.setItem('mg_code', res.code);
      stopPublicRoomsRefresh();
    });
  });

  function setHomeLoading(which) {
    $('btn-create').disabled = true;
    $('btn-goto-join').disabled = true;
    $('home-error').textContent = '';
    if (which === 'create') $('btn-create').innerHTML = '<span class="spin">⏳</span> Creating…';
  }
  function clearHomeLoading() {
    $('btn-create').disabled = false;
    $('btn-goto-join').disabled = false;
    $('btn-create').textContent = 'Create Room';
  }

  // ===================== PUBLIC ROOMS =====================
  function refreshPublicRooms() {
    socket.emit('getPublicRooms', (rooms) => {
      const list = $('public-rooms-list');
      list.innerHTML = '';
      if (!rooms || rooms.length === 0) {
        list.innerHTML = '<p class="muted center">No public rooms available right now.</p>';
        return;
      }
      rooms.forEach((r) => {
        const card = document.createElement('div');
        card.className = 'public-room-card';
        const full = r.playerCount >= r.maxPlayers;
        card.innerHTML = `
          <div class="pr-info">
            <span class="pr-host">🐐 ${escapeHtml(r.hostName)}</span>
            <span class="pr-meta">${r.playerCount}/${r.maxPlayers} players · ${r.teamMode ? '👥 Team' : '🎯 Solo'}</span>
          </div>
          <button class="btn btn-join btn-sm pr-join" ${full ? 'disabled' : ''} data-code="${r.code}">${full ? 'Full' : 'Join'}</button>
        `;
        const joinBtn = card.querySelector('.pr-join');
        if (!full) {
          joinBtn.addEventListener('click', () => {
            const name = $('home-name').value.trim();
            if (!name) return ($('join-error').textContent = 'Please enter your name on the home screen.');
            $('join-error').textContent = '';
            joinBtn.disabled = true;
            joinBtn.innerHTML = '<span class="spin">⏳</span>';
            socket.emit('joinRoom', { name, code: r.code }, (res) => {
              joinBtn.disabled = false;
              joinBtn.textContent = 'Join';
              if (res.error) return ($('join-error').textContent = res.error);
              leftRoom = false;
              myId = res.youId;
              localStorage.setItem('mg_name', name);
              localStorage.setItem('mg_code', res.code);
              stopPublicRoomsRefresh();
            });
          });
        }
        list.appendChild(card);
      });
    });
  }

  function startPublicRoomsRefresh() {
    stopPublicRoomsRefresh();
    publicRoomsTimer = setInterval(refreshPublicRooms, 4000);
  }
  function stopPublicRoomsRefresh() {
    if (publicRoomsTimer) { clearInterval(publicRoomsTimer); publicRoomsTimer = null; }
  }

  // ===================== LOBBY ROOM SETTINGS =====================
  $('btn-private').addEventListener('click', () => {
    socket.emit('setRoomVisibility', { isPublic: false });
  });
  $('btn-public').addEventListener('click', () => {
    socket.emit('setRoomVisibility', { isPublic: true });
  });
  $('btn-maxp-down').addEventListener('click', () => {
    if (!state) return;
    const cur = state.maxPlayers || 6;
    if (cur > 2) socket.emit('setMaxPlayers', { maxPlayers: cur - 1 });
  });
  $('btn-maxp-up').addEventListener('click', () => {
    if (!state) return;
    const cur = state.maxPlayers || 6;
    if (cur < 6) socket.emit('setMaxPlayers', { maxPlayers: cur + 1 });
  });

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
    const heading = document.querySelector('#leave-overlay h2');
    if (heading) heading.textContent = inGame ? 'Leave the game?' : 'Leave the lobby?';
    $('leave-msg').textContent = inGame
      ? 'Your goats will stay put, but your turn will be skipped.'
      : '';
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
    // Build share text with top 3 players
    const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
    const top3 = sorted.slice(0, 3).map((p, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉';
      return `${medal} ${p.name}: ${p.score}pts`;
    }).join('\n');

    let winnerLine = '';
    if (state.teamMode && state.teams && state.winnerTeamId != null) {
      const winTeam = state.teams.find((t) => t.id === state.winnerTeamId);
      winnerLine = winTeam ? `Team ${winTeam.name} wins!` : 'Game over!';
    } else {
      const winner = state.players.find((p) => p.id === state.winnerId);
      winnerLine = winner ? `${winner.name} wins!` : 'Game over!';
    }

    const text = `🐐 Mountain Goats — ${winnerLine}\n\n${top3}\n\nPlay at: ${location.origin}`;

    // Try to capture the overlay card as an image
    const overlayCard = document.querySelector('#win-overlay .overlay-card');
    if (overlayCard && typeof html2canvas === 'function') {
      // Temporarily hide the action buttons for a cleaner screenshot
      const actions = overlayCard.querySelector('.win-actions');
      if (actions) actions.style.display = 'none';

      html2canvas(overlayCard, {
        backgroundColor: '#0d1424',
        scale: 2,
        useCORS: true,
        logging: false,
      }).then((canvas) => {
        if (actions) actions.style.display = '';
        canvas.toBlob((blob) => {
          if (!blob) {
            // Fallback: share text only
            shareTextOnly(text);
            return;
          }
          const file = new File([blob], 'mountain-goats-result.png', { type: 'image/png' });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({
              title: 'Mountain Goats Result',
              text: text,
              files: [file],
            }).catch(() => shareTextOnly(text));
          } else if (navigator.share) {
            // Can share text but not files — share text only (no download)
            shareTextOnly(text);
          } else {
            // No share API at all (desktop) — copy text to clipboard
            if (navigator.clipboard) {
              navigator.clipboard.writeText(text).then(() => toast('Result copied! 📋'));
            }
          }
        }, 'image/png');
      }).catch(() => {
        if (actions) actions.style.display = '';
        shareTextOnly(text);
      });
    } else {
      shareTextOnly(text);
    }
  }

  function shareTextOnly(text) {
    if (navigator.share) {
      navigator.share({ title: 'Mountain Goats Result', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast('Result copied! 📋'));
    } else {
      toast(text.split('\n')[0]);
    }
  }

  function downloadImage(canvas) {
    try {
      const link = document.createElement('a');
      link.download = 'mountain-goats-result.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast('Image saved! 📸');
    } catch (e) { /* ignore */ }
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

  // Handle being kicked by the host
  socket.on('kicked', (data) => {
    leftRoom = true;
    state = null;
    localStorage.removeItem('mg_code');
    localStorage.removeItem('mg_name');
    $('win-overlay').classList.remove('show');
    show('home');
    const hostName = (data && data.hostName) ? data.hostName : 'The host';
    toast(`${hostName} kicked you from the room.`);
  });

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

  // Online player count
  socket.on('onlineCount', (count) => {
    const el = $('online-count');
    if (el) el.textContent = `🟢 ${count} player${count !== 1 ? 's' : ''} online`;
  });

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
    // If there are still adjustable dice (extra 1s that can be re-faced),
    // don't auto-end — the player hasn't had a chance to change them yet.
    const noneUsed = !state.diceUsed.some((u) => u);
    if (noneUsed && state.adjustable && state.adjustable.length > 0) return true;
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

    // Room settings (host only)
    const settingsCard = $('room-settings');
    if (settingsCard) {
      settingsCard.style.display = amHost ? 'block' : 'none';
      if (amHost) {
        const isPublic = state.isPublic || false;
        $('btn-private').classList.toggle('active', !isPublic);
        $('btn-public').classList.toggle('active', isPublic);
        $('maxp-display').textContent = state.maxPlayers || 6;
        $('btn-maxp-down').disabled = (state.maxPlayers || 6) <= Math.max(2, state.players.length);
        $('btn-maxp-up').disabled = (state.maxPlayers || 6) >= 6;
      }
    }

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
          li.innerHTML = `<span class="swatch${p.id === myId ? ' me' : ''}" style="background:${p.color}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
            <span class="player-name">${escapeHtml(p.name)}</span>`;
          if (p.id === state.hostId) li.innerHTML += `<span class="host-icon" title="Host">👑</span>`;
          else li.innerHTML += `<span class="player-type-icon ${p.isBot ? 'bot' : 'human'}" title="${p.isBot ? 'Bot' : 'Player'}">${p.isBot ? '🤖' : '👤'}</span>`;
          if (p.id === myId) li.innerHTML += `<span class="badge you">YOU</span>`;
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
          if (amHost && p.id !== myId) {
            const x = document.createElement('button');
            x.className = 'kick-btn';
            x.textContent = '✕';
            x.title = p.isBot ? 'Remove bot' : 'Kick player';
            x.addEventListener('click', () => socket.emit('kickPlayer', { id: p.id }));
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
        li.innerHTML = `<span class="swatch${p.id === myId ? ' me' : ''}" style="background:${p.color}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
          <span class="player-name">${escapeHtml(p.name)}</span>
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
        if (amHost && p.id !== myId) {
          const x = document.createElement('button');
          x.className = 'kick-btn';
          x.textContent = '✕';
          x.title = p.isBot ? 'Remove bot' : 'Kick player';
          x.addEventListener('click', () => socket.emit('kickPlayer', { id: p.id }));
          li.appendChild(x);
        }
        ul.appendChild(li);
      });
    } else {
      // Standard mode: render flat player list
      state.players.forEach((p) => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="swatch${p.id === myId ? ' me' : ''}" style="background:${p.color}">${escapeHtml(p.name.charAt(0).toUpperCase())}</span>
          <span class="player-name">${escapeHtml(p.name)}</span>`;
        if (p.id === state.hostId) li.innerHTML += `<span class="host-icon" title="Host">👑</span>`;
        else li.innerHTML += `<span class="player-type-icon ${p.isBot ? 'bot' : 'human'}" title="${p.isBot ? 'Bot' : 'Player'}">${p.isBot ? '🤖' : '👤'}</span>`;
        if (p.id === myId) li.innerHTML += `<span class="badge you">YOU</span>`;
        if (amHost && p.id !== myId) {
          const x = document.createElement('button');
          x.className = 'kick-btn';
          x.textContent = '✕';
          x.title = p.isBot ? 'Remove bot' : 'Kick player';
          x.addEventListener('click', () => socket.emit('kickPlayer', { id: p.id }));
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
    addBtn.disabled = state.players.length >= (state.maxPlayers || 6);

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
        $('lobby-hint').textContent = '⚠️ Teams must be equal to start!';
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
    const lead = Math.max(0, ...state.players.map((p) => p.score || 0));

    if (state.teamMode && state.teams) {
      // Team mode: display team scorecards
      const teamLead = Math.max(0, ...state.teams.map((t) => t.score || 0));
      const numTeams = state.teams.length;

      // Build ordered member lists per team based on actual turn order
      const teamOrder = state.teams.map(() => []);
      state.players.forEach((p) => {
        const tIdx = state.teams.findIndex((t) => t.members.includes(p.id));
        if (tIdx >= 0) teamOrder[tIdx].push(p);
      });

      // All team configs: stacked vertically, each team as a block with members in a row
      state.teams.forEach((t, tIdx) => {
        const isLead = t.score === teamLead && teamLead > 0;
        const teamBlock = document.createElement('div');
        teamBlock.className = 'team-block';
        teamBlock.style.setProperty('--tc', t.color);

        // Team header
        const head = document.createElement('div');
        head.className = 'tg-head';
        head.style.setProperty('--tc', t.color);
        head.innerHTML = `<span class="tg-dot" style="background:${t.color}"></span>
          <span class="tg-name">${escapeHtml(t.name)}</span>
          <span class="tg-tops">👑${t.tops || 0}</span>
          <span class="tg-score">${isLead ? '▲ ' : ''}⭐ ${t.score || 0}</span>`;
        teamBlock.appendChild(head);

        // Members in a row
        const membersRow = document.createElement('div');
        membersRow.className = 'team-block-members';
        teamOrder[tIdx].forEach((p) => {
          membersRow.appendChild(buildPlayerPanel(p, t));
        });
        teamBlock.appendChild(membersRow);
        strip.appendChild(teamBlock);
      });

      // Helper to build a player panel
      function buildPlayerPanel(p, t) {
        const idx = state.players.indexOf(p);
        const panel = document.createElement('div');
        panel.className = 'pp team-pp' + (idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off');
        panel.style.setProperty('--tc', t.color);
        const pos = p.pos || [];
        const collected = p.collected || [];
        let chips = '';
        state.mountains.forEach((m, mi) => {
          const onTop = (pos[mi] || 0) >= m.height;
          const n = collected[mi] || 0;
          chips += `<span class="pp-chip${n > 0 ? ' has' : ''}${onTop ? ' top' : ''}" style="--c:${m.color}">${m.value}<b>×${n}</b></span>`;
        });
        const topsTag = (p.tops || 0) > 0 ? `<span class="pp-tops">👑${p.tops}</span>` : '';
        const bonusTag = p.bonus && p.bonus.length ? `<span class="pp-bonus">✨${p.bonusPoints || 0}</span>` : '';
        const setsTag = (p.sets || 0) > 0 ? `<span class="pp-sets">📦${p.sets}</span>` : '';
        const offTag = !p.connected && !p.isBot ? '<span class="pp-auto">🤖 auto</span>' : '';
        panel.innerHTML = `
          <div class="pp-head">
            ${playerCoinHtml(p, 'sm')}
            <span class="pp-name">${escapeHtml(p.name)}${p.id === myId ? ' (You)' : ''}</span>
            ${offTag}${setsTag}${topsTag}${bonusTag}<span class="pp-score">⭐ ${p.score || 0}</span>
          </div>
          <div class="pp-mtns">${chips}</div>`;
        return panel;
      }
    } else {
      // Standard mode: flat player panels
      state.players.forEach((p, idx) => {
        const panel = document.createElement('div');
        panel.className = 'pp' + (idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off');
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
        panel.innerHTML = `
          <div class="pp-head">
            ${playerCoinHtml(p, 'sm')}
            <span class="pp-name">${escapeHtml(p.name)}${p.id === myId ? ' (You)' : ''}</span>
            ${offTag}${setsTag}${topsTag}${bonusTag}<span class="pp-score">${leadTag}⭐ ${p.score || 0}</span>
          </div>
          <div class="pp-mtns">${chips}</div>`;
        strip.appendChild(panel);
      });
    }
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





