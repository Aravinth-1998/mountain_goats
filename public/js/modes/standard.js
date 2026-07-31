/**
 * Standard-mode client UI hooks.
 */
(function (root) {
  const GameModes = root.GameModes;
  if (!GameModes) return;

  const PLACE_PHRASES = [
    'You are the real GOAT!',
    'Almost claimed the summit',
    'Solid climb - keep hoofing',
    'The mountain remembers',
    'Every goat starts at base',
    "Next summit's yours",
  ];

  /**
   * Winner slots in standard mode: 1 for 2-4 players, 2 for 5-7, 3 for 8-10.
   *
   * @param {number} playerCount Number of players.
   * @returns {number}
   */
  function winnerSlotCount(playerCount) {
    if (playerCount >= 8) return 3;
    if (playerCount >= 5) return 2;
    return 1;
  }

  /**
   * @param {number} rankIndex Zero-based rank.
   * @param {number} winnerSlots Winner slot count.
   * @returns {string}
   */
  function scoreRankPrefix(rankIndex, winnerSlots) {
    if (rankIndex === 0) return '🥇';
    if (rankIndex === 1 && winnerSlots >= 2) return '🥈';
    if (rankIndex === 2 && winnerSlots >= 3) return '🥉';
    return String(rankIndex + 1);
  }

  /**
   * @param {string[]} names Winner display names.
   * @returns {string}
   */
  function formatWinnerNames(names) {
    if (names.length <= 1) return names[0] || '';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
  }

  /**
   * @param {object|null} state Public state.
   * @param {string} playerId Player id.
   * @returns {boolean}
   */
  function didPlayerWin(state, playerId) {
    if (!state || !state.finished || !playerId) return false;
    const winnerIds = state.winnerPlayerIds && state.winnerPlayerIds.length
      ? state.winnerPlayerIds
      : (state.winnerId ? [state.winnerId] : []);
    return winnerIds.includes(playerId);
  }

  /**
   * @param {object} room Public room summary.
   * @returns {string}
   */
  function roomsListLabel(room) {
    return '🎯 Solo';
  }

  /**
   * @param {object} state Public state.
   * @param {object|null} player Player or null.
   * @param {string[]} fallback Default palette.
   * @returns {string[]}
   */
  function getPlayerColors(state, player, fallback) {
    return (state && state.playerColors) || fallback;
  }

  /**
   * @param {object} socket Socket.IO client.
   * @returns {void}
   */
  function emitSetMode(socket) {
    socket.emit('setGameMode', { modeId: 'standard' });
  }

  /**
   * @param {object} state Public state.
   * @returns {boolean}
   */
  function teamsUnequal(state) {
    return false;
  }

  /**
   * @param {object} state Public state.
   * @param {boolean} amHost Host flag.
   * @returns {string}
   */
  function lobbyReadyHint(state, amHost) {
    return 'Ready when you are!';
  }

  /**
   * @param {object} state Public state.
   * @returns {{ standings: string, winnerLine: string }}
   */
  function shareLines(state) {
    const sorted = [...state.players].sort((a, b) => b.score - a.score || b.tops - a.tops);
    const slots = winnerSlotCount(state.players.length);
    const standings = sorted.map((p, i) => {
      const prefix = scoreRankPrefix(i, slots);
      return `${prefix} ${p.name}: ${p.score}pts`;
    }).join('\n');

    const winnerIds = state.winnerPlayerIds && state.winnerPlayerIds.length
      ? state.winnerPlayerIds
      : (state.winnerId ? [state.winnerId] : []);
    const winners = winnerIds
      .map((id) => state.players.find((p) => p.id === id))
      .filter(Boolean);
    let winnerLine = 'Game over!';
    if (winners.length >= 2) {
      winnerLine = `${formatWinnerNames(winners.map((p) => p.name))} win!`;
    } else if (winners.length === 1) {
      winnerLine = `${winners[0].name} wins!`;
    }
    return { standings, winnerLine };
  }

  /**
   * Update Standard/Team toggle and hide team config.
   *
   * @param {object} ctx Context with $ and state.
   * @returns {void}
   */
  function updateLobbySettings(ctx) {
    const { $, state, amHost } = ctx;
    const teamsOffBtn = $('btn-teams-off');
    const teamsOnBtn = $('btn-teams-on');
    const teamConfigRow = $('team-config-row');
    if (amHost && teamsOffBtn && teamsOnBtn) {
      teamsOffBtn.classList.toggle('active', true);
      teamsOnBtn.classList.toggle('active', false);
      if (teamConfigRow) teamConfigRow.hidden = true;
    }
    const teamMoveHint = $('team-move-hint');
    if (teamMoveHint) teamMoveHint.hidden = true;
  }

  /**
   * Render flat lobby player list.
   *
   * @param {HTMLElement} ul Lobby list.
   * @param {object} ctx Render helpers.
   * @returns {void}
   */
  function renderLobbyPlayers(ul, ctx) {
    const { state, myId, amHost, lobbyPlayerRowHtml, lobbyPlayerBadgesHtml, appendKickBtn, attachLobbySwatch } = ctx;
    ul.classList.toggle('team-lobby', false);
    state.players.forEach((p) => {
      const li = document.createElement('li');
      if (p.id === myId) li.classList.add('lobby-you');
      li.innerHTML = lobbyPlayerRowHtml(p, lobbyPlayerBadgesHtml(p, ''));
      appendKickBtn(li, p, amHost);
      attachLobbySwatch(li, p);
      ul.appendChild(li);
    });
  }

  /**
   * Render flat in-game stats strip.
   *
   * @param {HTMLElement} strip Stats container.
   * @param {object} ctx Helpers including escapeHtml, playerCoinHtml.
   * @returns {void}
   */
  function renderStats(strip, ctx) {
    const { state, escapeHtml, playerCoinHtml } = ctx;
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
      const bonusTag = p.bonus && p.bonus.length ? `<span class="pp-bonus">✨${p.bonusPoints || 0}</span>` : '';
      panel.innerHTML = `
          <div class="pp-head">
            ${playerCoinHtml(p, 'sm')}
            <span class="pp-name">${escapeHtml(p.name)}</span>
            ${bonusTag}<span class="pp-score">⭐ ${p.score || 0}</span>
          </div>
          <div class="pp-mtns">${chips}</div>`;
      strip.appendChild(panel);
    });
  }

  /**
   * @param {number} rankIndex
   * @param {number} winnerSlots
   * @returns {string}
   */
  function scoreRankPrefixHtml(rankIndex, winnerSlots) {
    const prefix = scoreRankPrefix(rankIndex, winnerSlots);
    if (prefix === '🥇' || prefix === '🥈' || prefix === '🥉') return prefix;
    return `<span class="sb-rank-num">${prefix}</span>`;
  }

  /**
   * @param {number} rankIndex
   * @param {number} winnerSlots
   * @returns {string}
   */
  function catchphrase(rankIndex, winnerSlots) {
    if (rankIndex === 0) return PLACE_PHRASES[0];
    if (rankIndex === 1 && winnerSlots >= 2) return 'Shared summit!';
    if (rankIndex === 2 && winnerSlots >= 3) return 'Podium finish!';
    if (rankIndex >= 0 && rankIndex < PLACE_PHRASES.length) return PLACE_PHRASES[rankIndex];
    return PLACE_PHRASES[PLACE_PHRASES.length - 1];
  }

  /**
   * Fill end-game overlay for standard mode.
   *
   * @param {object} ctx Win overlay context.
   * @returns {void}
   */
  function fillWinOverlay(ctx) {
    const {
      state, myId, $, escapeHtml, playerCoinHtml, winScoreRightHtml, endReasonBadge,
      resetWinHeadChrome, ordinalPlace, sortedPlayersByScore,
    } = ctx;

    let winner = state.players.find((p) => p.id === state.winnerId) || null;
    if (!winner && state.winnerPlayerIds && state.winnerPlayerIds.length) {
      winner = state.players.find((p) => p.id === state.winnerPlayerIds[0]) || null;
    }
    if (!winner) {
      const ranked = sortedPlayersByScore();
      winner = ranked[0] || null;
    }

    const placeEl = $('win-place');
    const outcomeEl = $('win-outcome');
    const titleEl = $('win-title');
    const head = document.querySelector('#win-overlay .win-head');
    const trophy = document.querySelector('#win-overlay .trophy');
    const sorted = sortedPlayersByScore();
    const rankIndex = sorted.findIndex((p) => p.id === myId);
    const winnerSlots = winnerSlotCount(state.players.length);
    const localWon = didPlayerWin(state, myId);

    if (rankIndex < 0) {
      resetWinHeadChrome();
      if (localWon) titleEl.textContent = 'You Win! 🎉';
      else if (winnerSlots >= 2 && sorted.length >= winnerSlots) {
        const names = sorted.slice(0, winnerSlots).map((p) => p.name);
        titleEl.textContent = `${formatWinnerNames(names)} Win!`;
      } else {
        titleEl.textContent = winner ? `${winner.name} Wins!` : 'Game Over!';
      }
    } else {
      if (placeEl) {
        placeEl.hidden = false;
        placeEl.textContent = ordinalPlace(rankIndex + 1) + ' place';
      }
      titleEl.textContent = catchphrase(rankIndex, winnerSlots);
      if (trophy) {
        trophy.textContent = localWon ? '🏆' : '';
        trophy.hidden = !localWon;
      }
      if (head) head.classList.toggle('win-head-mid', !localWon);
      if (outcomeEl) {
        if (!localWon && winner) {
          outcomeEl.hidden = false;
          outcomeEl.textContent = winner.name + ' won with ' + winner.score + ' pts';
        } else {
          outcomeEl.hidden = true;
          outcomeEl.textContent = '';
        }
      }
    }

    const rows = sorted.map((p, i) => {
      const prefix = scoreRankPrefixHtml(i, winnerSlots);
      const isWinner = i < winnerSlots;
      const bonusTag = p.bonus && p.bonus.length ? ` <span class="sb-bonus">✨+${p.bonusPoints}</span>` : '';
      return `<div class="score-row${isWinner ? ' win' : ''}" style="--i:${i}">
          <span class="sb-left">${prefix} ${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}${bonusTag}</span>
          ${winScoreRightHtml(p.score, p.tops)}
        </div>`;
    }).join('');

    let extraIdx = sorted.length;
    let tieNote = '';
    if (winner) {
      const topScore = winner.score;
      const tied = state.players.filter((p) => p.score === topScore);
      if (tied.length > 1) {
        const topTops = winner.tops;
        const tiedOnTops = tied.filter((p) => p.tops === topTops);
        if (tiedOnTops.length > 1) {
          tieNote = `<div class="tiebreak win-extra" style="--i:${extraIdx++}">🏔️ Tie broken by goat on the higher-numbered mountain.</div>`;
        } else {
          tieNote = `<div class="tiebreak win-extra" style="--i:${extraIdx++}">👑 Tie broken by most goats on mountain tops.</div>`;
        }
      }
    }

    $('win-sub').innerHTML = `<div class="scoreboard">${rows}</div>
        ${tieNote}
        ${endReasonBadge(state.endReason, extraIdx)}`;
    document.querySelector('#win-overlay .win-actions').style.setProperty('--rows', String(sorted.length));
  }

  GameModes.register({
    id: 'standard',
    label: 'Standard',
    usesTeams: false,
    roomsListLabel,
    didPlayerWin,
    getPlayerColors,
    emitSetMode,
    teamsUnequal,
    lobbyReadyHint,
    shareLines,
    updateLobbySettings,
    renderLobbyPlayers,
    renderStats,
    fillWinOverlay,
    winnerSlotCount,
    scoreRankPrefix,
  });
})(typeof window !== 'undefined' ? window : globalThis);
