/**
 * Team-mode client UI hooks.
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
   * @param {number} rankIndex Zero-based team rank.
   * @returns {string}
   */
  function teamRankPrefix(rankIndex) {
    return rankIndex === 0 ? '🥇' : String(rankIndex + 1);
  }

  /**
   * @param {object|null} state Public state.
   * @param {string} playerId Player id.
   * @returns {boolean}
   */
  function didPlayerWin(state, playerId) {
    if (!state || !state.finished || !playerId) return false;
    if (!state.teams || state.winnerTeamId == null) return false;
    const winTeam = state.teams.find((team) => team.id === state.winnerTeamId);
    const playerTeam = state.teams.find((team) => team.members.includes(playerId));
    return !!(winTeam && playerTeam && playerTeam.id === winTeam.id);
  }

  /**
   * @param {object} room Public room summary.
   * @returns {string}
   */
  function roomsListLabel(room) {
    return t('mode.teamRoomsList');
  }

  /**
   * @param {object} state Public state.
   * @param {object|null} player Player or null.
   * @param {string[]} fallback Default palette.
   * @returns {string[]}
   */
  function getPlayerColors(state, player, fallback) {
    if (state && state.teamPalettes) {
      if (player) {
        const team = state.teams && state.teams.find((t) => t.members.includes(player.id));
        if (team && state.teamPalettes[team.id]) {
          return state.teamPalettes[team.id];
        }
        const seen = new Set();
        const colors = [];
        state.teamPalettes.forEach((pal) => {
          pal.forEach((c) => {
            if (!seen.has(c)) {
              seen.add(c);
              colors.push(c);
            }
          });
        });
        if (colors.length) return colors;
      }
    }
    return (state && state.playerColors) || fallback;
  }

  /**
   * @param {object} socket Socket.IO client.
   * @returns {void}
   */
  function emitSetMode(socket) {
    socket.emit('setGameMode', { modeId: 'standardTeam' });
  }

  /**
   * @param {object} state Public state.
   * @returns {boolean}
   */
  function teamsUnequal(state) {
    if (!state.teams || state.teams.length < 2) return false;
    const sizes = state.teams.map((t) => t.members.length);
    return sizes.some((s) => s !== sizes[0]) || sizes.some((s) => s === 0);
  }

  /**
   * @param {object} state Public state.
   * @param {boolean} amHost Host flag.
   * @returns {string}
   */
  function lobbyReadyHint(state, amHost) {
    return t('lobby.hintTeamsReady');
  }

  /**
   * @param {object} state Public state.
   * @returns {{ standings: string, winnerLine: string }}
   */
  function shareLines(state) {
    const sortedTeams = [...(state.teams || [])].sort(
      (a, b) => (b.score || 0) - (a.score || 0) || (b.tops || 0) - (a.tops || 0)
    );
    const standings = sortedTeams.map((tm, i) => {
      const prefix = teamRankPrefix(i);
      return t('share.teamStanding', {
        prefix,
        name: tm.name,
        score: `${tm.score || 0} ⭐`,
      });
    }).join('\n');

    let winnerLine = t('share.gameOver');
    if (state.winnerTeamId != null && state.teams) {
      const winTeam = state.teams.find((tm) => tm.id === state.winnerTeamId);
      if (winTeam) winnerLine = t('share.teamWins', { name: winTeam.name });
    }
    return { standings, winnerLine };
  }

  /**
   * @param {object} ctx Context with $ and state.
   * @returns {void}
   */
  function updateLobbySettings(ctx) {
    const { $, state, amHost } = ctx;
    const teamsOffBtn = $('btn-teams-off');
    const teamsOnBtn = $('btn-teams-on');
    const teamConfigRow = $('team-config-row');
    if (amHost && teamsOffBtn && teamsOnBtn) {
      teamsOffBtn.classList.toggle('active', false);
      teamsOnBtn.classList.toggle('active', true);
      if (teamConfigRow) {
        teamConfigRow.hidden = false;
        if (state.teams) {
          const numTeams = state.teams.length;
          $('btn-2teams').classList.toggle('active', numTeams === 2);
          $('btn-3teams').classList.toggle('active', numTeams === 3);
          $('btn-3teams').style.display = '';
        }
      }
    }
    const teamMoveHint = $('team-move-hint');
    if (teamMoveHint) {
      teamMoveHint.hidden = !state.teams;
      if (state.teams) {
        teamMoveHint.textContent = amHost
          ? t('lobby.teamMoveHost')
          : t('lobby.teamMoveSelf');
      }
    }
  }

  /**
   * @param {HTMLElement} ul Lobby list.
   * @param {object} ctx Helpers including team band builders.
   * @returns {void}
   */
  function renderLobbyPlayers(ul, ctx) {
    const {
      state, amHost, buildTeamBand, buildUnassignedBand, wireTeamBandInteractions,
    } = ctx;
    ul.classList.toggle('team-lobby', !!(state.teams));
    if (!state.teams) {
      ul.classList.toggle('team-lobby', false);
      return;
    }
    state.teams.forEach((team) => {
      ul.appendChild(buildTeamBand(team, amHost));
    });
    const assigned = new Set(state.teams.flatMap((tm) => tm.members));
    const unassigned = state.players.filter((p) => !assigned.has(p.id));
    if (unassigned.length) {
      ul.appendChild(buildUnassignedBand(unassigned, amHost));
    }
    wireTeamBandInteractions(ul, amHost);
  }

  /**
   * @param {HTMLElement} strip Stats container.
   * @param {object} ctx Helpers.
   * @returns {void}
   */
  function renderStats(strip, ctx) {
    const { state, escapeHtml, playerCoinHtml, myId } = ctx;
    if (!state.teams) return;

    const teamOrder = state.teams.map(() => []);
    state.players.forEach((p) => {
      const tIdx = state.teams.findIndex((tm) => tm.members.includes(p.id));
      if (tIdx >= 0) teamOrder[tIdx].push(p);
    });

    function buildPlayerPanel(p) {
      const idx = state.players.indexOf(p);
      const panel = document.createElement('div');
      panel.className = 'pp team-pp' + (p.id === myId && idx === state.currentIndex ? ' active' : '') + (p.connected ? '' : ' off');
      panel.style.setProperty('--c', p.color);
      if (window.MGUi && typeof window.MGUi.isLightColor === 'function' && window.MGUi.isLightColor(p.color)) {
        panel.classList.add('is-light');
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
      return panel;
    }

    state.teams.forEach((tm, tIdx) => {
      const teamBlock = document.createElement('div');
      teamBlock.className = 'team-block';
      teamBlock.style.setProperty('--tc', tm.color);

      const head = document.createElement('div');
      head.className = 'tg-head';
      head.style.setProperty('--tc', tm.color);
      head.innerHTML = `<span class="tg-dot" style="background:${tm.color}"></span>
          <span class="tg-name">${escapeHtml(tm.name)}</span>
          <span class="tg-score">⭐ ${tm.score || 0}</span>`;
      teamBlock.appendChild(head);

      const membersRow = document.createElement('div');
      membersRow.className = 'team-block-members';
      teamOrder[tIdx].forEach((p) => {
        membersRow.appendChild(buildPlayerPanel(p));
      });
      teamBlock.appendChild(membersRow);
      strip.appendChild(teamBlock);
    });
  }

  /**
   * @param {number} rankIndex
   * @returns {string}
   */
  function catchphrase(rankIndex) {
    if (rankIndex >= 0 && rankIndex <= 2) return t('win.teamPhrase' + rankIndex);
    return t('win.teamPhrase2');
  }

  /**
   * @param {object[]} sortedTeams
   * @param {object} winTeam
   * @param {function} escapeHtml
   * @param {function} colorWithAlpha
   * @returns {string}
   */
  function teamRivalryHtml(sortedTeams, winTeam, escapeHtml, colorWithAlpha) {
    const a = sortedTeams[0];
    const b = sortedTeams[1];
    const total = (a.score || 0) + (b.score || 0);
    const pctA = total > 0 ? Math.round(((a.score || 0) / total) * 100) : 50;
    const pctB = 100 - pctA;
    const side = (tm, i) => {
      const isWin = tm.id === winTeam.id;
      const bg = colorWithAlpha(tm.color, 0.12);
      const border = colorWithAlpha(tm.color, isWin ? 0.55 : 0.35);
      return `<div class="win-rival-side${isWin ? ' winner' : ''} win-extra" style="--i:${i};background:${bg};border-color:${border}">
        <div class="win-rival-name" style="color:${escapeHtml(tm.color)}">${escapeHtml(tm.name)}</div>
        <div class="win-rival-score">${tm.score || 0}</div>
      </div>`;
    };
    return `<div class="win-rival">
      ${side(a, 0)}
      <div class="win-rival-vs win-extra" style="--i:0">${t('win.vs')}</div>
      ${side(b, 1)}
    </div>
    <div class="win-bar-track win-extra" style="--i:1">
      <div class="win-bar-seg" style="width:${pctA}%;background:${escapeHtml(a.color)}"></div>
      <div class="win-bar-seg" style="width:${pctB}%;background:${escapeHtml(b.color)}"></div>
    </div>`;
  }

  /**
   * @param {object[]} sortedTeams
   * @param {function} escapeHtml
   * @param {function} colorWithAlpha
   * @returns {string}
   */
  function teamPodiumHtml(sortedTeams, escapeHtml, colorWithAlpha) {
    const first = sortedTeams[0];
    const second = sortedTeams[1];
    const third = sortedTeams[2];
    const pod = (tm, placeClass, placeLabel, i) => {
      if (!tm) return '';
      const barAlpha = placeClass === 'first' ? 0.55 : 0.45;
      const barBg = colorWithAlpha(tm.color, barAlpha);
      return `<div class="win-pod ${placeClass} win-extra" style="--i:${i}">
        <div class="win-pod-place">${placeLabel}</div>
        <div class="win-pod-name" style="color:${escapeHtml(tm.color)}">${escapeHtml(tm.name)}</div>
        <div class="win-pod-height" style="background:${barBg}"><span class="win-pod-bar-score">${tm.score || 0}</span></div>
      </div>`;
    };
    return `<div class="win-podium">
      ${pod(second, 'second', t('win.ordinal2'), 0)}
      ${pod(first, 'first', t('win.ordinal1'), 1)}
      ${pod(third, 'third', t('win.ordinal3'), 2)}
    </div>`;
  }

  /**
   * @param {object} ctx Win overlay context.
   * @returns {void}
   */
  function fillWinOverlay(ctx) {
    const {
      state, myId, $, escapeHtml, playerCoinHtml, winScoreRightHtml,
      resetWinHeadChrome, ordinalPlace, sortedPlayersByScore, colorWithAlpha,
    } = ctx;

    const winTeam = state.teams && state.winnerTeamId != null
      ? state.teams.find((tm) => tm.id === state.winnerTeamId)
      : null;
    if (!winTeam) {
      resetWinHeadChrome();
      $('win-title').textContent = t('win.gameOver');
      $('win-sub').innerHTML = '';
      return;
    }

    const sortedTeams = [...state.teams].sort(
      (a, b) => (b.score || 0) - (a.score || 0) || (b.tops || 0) - (a.tops || 0)
    );
    const placeEl = $('win-place');
    const outcomeEl = $('win-outcome');
    const titleEl = $('win-title');
    const head = document.querySelector('#win-overlay .win-head');
    const trophy = document.querySelector('#win-overlay .trophy');
    const rankIndex = sortedTeams.findIndex((tm) => tm.members && tm.members.includes(myId));
    const localWon = didPlayerWin(state, myId);

    if (rankIndex < 0) {
      resetWinHeadChrome();
      titleEl.textContent = t('win.teamWins', { name: winTeam.name });
    } else {
      if (placeEl) {
        placeEl.hidden = false;
        placeEl.textContent = t('win.place', { place: ordinalPlace(rankIndex + 1) });
      }
      titleEl.textContent = catchphrase(rankIndex);
      if (trophy) {
        trophy.textContent = localWon ? '🏆' : '';
        trophy.hidden = !localWon;
      }
      if (head) head.classList.toggle('win-head-mid', !localWon);
      if (outcomeEl) {
        if (!localWon) {
          outcomeEl.hidden = false;
          outcomeEl.textContent = t('win.teamOutcome', {
            name: winTeam.name,
            score: winTeam.score || 0,
          });
        } else {
          outcomeEl.hidden = true;
          outcomeEl.textContent = '';
        }
      }
    }

    let teamViz = '';
    let vizRows = 2;
    if (sortedTeams.length === 2) {
      teamViz = teamRivalryHtml(sortedTeams, winTeam, escapeHtml, colorWithAlpha);
      vizRows = 2;
    } else if (sortedTeams.length >= 3) {
      teamViz = teamPodiumHtml(sortedTeams, escapeHtml, colorWithAlpha);
      vizRows = 3;
    }

    let rowIdx = vizRows;
    const labelIdx = rowIdx++;
    const sorted = sortedPlayersByScore();
    const playerRows = sorted.map((p) => {
      const team = state.teams.find((tm) => tm.members.includes(p.id));
      const teamBorder = team ? `border-color:${escapeHtml(team.color)}` : '';
      const idx = rowIdx++;
      return `<div class="score-row score-row-sm" style="--i:${idx};${teamBorder}">
          <span class="sb-left">${playerCoinHtml(p, 'sm', { markMe: false })} ${escapeHtml(p.name)}${p.isBot ? ' 🤖' : ''}</span>
          ${winScoreRightHtml(p.score, p.bonusPoints)}
        </div>`;
    }).join('');

    $('win-sub').innerHTML = `${teamViz}
        <div class="team-breakdown-label win-extra" style="--i:${labelIdx}">${t('win.individualScores')}</div>
        <div class="scoreboard scoreboard-sm">${playerRows}</div>`;
    document.querySelector('#win-overlay .win-actions').style.setProperty('--rows', String(rowIdx));
  }

  GameModes.register({
    id: 'standardTeam',
    get label() { return t('mode.team'); },
    usesTeams: true,
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
    teamRankPrefix,
  });
})(typeof window !== 'undefined' ? window : globalThis);
