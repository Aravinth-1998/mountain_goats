/**
 * Standard-mode client UI hooks.
 */
(function (root) {
  const GameModes = root.GameModes;
  if (!GameModes) return;

  /**
   * Translate a catalog key (falls back to the key).
   *
   * @param {string} key Dotted catalog key.
   * @param {Record<string, string|number>} [vars] Interpolation values.
   * @returns {string}
   */
  function t(key, vars) {
    return root.t ? root.t(key, vars) : key;
  }

  /**
   * Whether the active theme enables a feature. False when ui.js is missing,
   * which keeps the baseline Classic markup.
   *
   * @param {string} feature Feature name from the ui.js theme registry.
   * @returns {boolean}
   */
  function themeHas(feature) {
    return !!(root.MGUi
      && typeof root.MGUi.hasFeature === 'function'
      && root.MGUi.hasFeature(feature));
  }

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
    if (names.length === 2) return `${names[0]} ${t('win.and')} ${names[1]}`;
    return `${names.slice(0, -1).join(', ')}${t('win.listAnd')}${names[names.length - 1]}`;
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
    return t('mode.standardRoomsList');
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
    return t('lobby.hintReady');
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
      if (p.bonusPoints > 0) {
        return t('share.standingBonus', {
          prefix,
          name: p.name,
          bonus: `${p.bonusPoints} ✨`,
          score: `${p.score} ⭐`,
        });
      }
      return t('share.standing', {
        prefix,
        name: p.name,
        score: `${p.score} ⭐`,
      });
    }).join('\n');

    const winnerIds = state.winnerPlayerIds && state.winnerPlayerIds.length
      ? state.winnerPlayerIds
      : (state.winnerId ? [state.winnerId] : []);
    const winners = winnerIds
      .map((id) => state.players.find((p) => p.id === id))
      .filter(Boolean);
    let winnerLine = t('share.gameOver');
    if (winners.length >= 2) {
      winnerLine = t('share.namesWin', {
        names: formatWinnerNames(winners.map((p) => p.name)),
      });
    } else if (winners.length === 1) {
      winnerLine = t('share.nameWins', { name: winners[0].name });
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
    const panelColor = themeHas('panelPlayerColor');
    state.players.forEach((p, idx) => {
      const isActive = idx === state.currentIndex;
      const panel = document.createElement('div');
      panel.className = 'pp' + (isActive ? ' active' : '') + (p.connected ? '' : ' off');
      if (panelColor) {
        panel.style.setProperty('--c', p.color);
        if (root.MGUi.isLightColor(p.color)) panel.classList.add('is-light');
      }
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
    if (rankIndex === 0) return t('win.phrase0');
    if (rankIndex === 1 && winnerSlots >= 2) return t('win.sharedSummit');
    if (rankIndex === 2 && winnerSlots >= 3) return t('win.podiumFinish');
    if (rankIndex >= 0 && rankIndex <= 5) return t('win.phrase' + rankIndex);
    return t('win.phrase5');
  }

  /**
   * Fill end-game overlay for standard mode.
   *
   * @param {object} ctx Win overlay context.
   * @returns {void}
   */
  function fillWinOverlay(ctx) {
    const {
      state, myId, $, escapeHtml, playerCoinHtml, winScoreRightHtml,
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
      if (localWon) titleEl.textContent = t('win.youWin') + ' 🎉';
      else if (winnerSlots >= 2 && sorted.length >= winnerSlots) {
        const names = sorted.slice(0, winnerSlots).map((p) => p.name);
        titleEl.textContent = t('win.namesWin', { names: formatWinnerNames(names) });
      } else {
        titleEl.textContent = winner
          ? t('win.nameWins', { name: winner.name })
          : t('win.gameOver');
      }
    } else {
      if (placeEl) {
        placeEl.hidden = false;
        placeEl.textContent = t('win.place', { place: ordinalPlace(rankIndex + 1) });
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
          outcomeEl.textContent = t('win.outcomePts', {
            name: winner.name,
            score: winner.score,
          });
        } else {
          outcomeEl.hidden = true;
          outcomeEl.textContent = '';
        }
      }
    }

    const rows = sorted.map((p, i) => {
      const prefix = scoreRankPrefixHtml(i, winnerSlots);
      const isWinner = i < winnerSlots;
      return `<div class="score-row${isWinner ? ' win' : ''}" style="--i:${i}">
          <span class="sb-left">${prefix} ${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
          ${winScoreRightHtml(p.score, p.bonusPoints)}
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
          tieNote = `<div class="tiebreak win-extra" style="--i:${extraIdx++}">🏔️ ${t('win.tieHigherMountain')}</div>`;
        } else {
          tieNote = `<div class="tiebreak win-extra" style="--i:${extraIdx++}">👑 ${t('win.tieMostTops')}</div>`;
        }
      }
    }

    $('win-sub').innerHTML = `<div class="scoreboard">${rows}</div>
        ${tieNote}`;
    document.querySelector('#win-overlay .win-actions').style.setProperty('--rows', String(sorted.length));
  }

  GameModes.register({
    id: 'standard',
    get label() { return t('mode.standard'); },
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
