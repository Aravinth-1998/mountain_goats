/**
 * Client-only interactive tutorial — full Standard rules.
 * Fixed script for all users; advances only on required taps.
 */
(function () {
  const MOUNTAIN_COLOR = '#aab8c9';
  const MOUNTAINS = [
    { value: 5, height: 4, chips: 10, color: MOUNTAIN_COLOR },
    { value: 6, height: 4, chips: 9, color: MOUNTAIN_COLOR },
    { value: 7, height: 3, chips: 8, color: MOUNTAIN_COLOR },
    { value: 8, height: 3, chips: 7, color: MOUNTAIN_COLOR },
    { value: 9, height: 2, chips: 6, color: MOUNTAIN_COLOR },
    { value: 10, height: 2, chips: 5, color: MOUNTAIN_COLOR },
  ];

  const MI_10 = 5;
  const YOU_ID = 'tut-you';
  const RIVAL_ID = 'tut-rival';

  /** @type {ReturnType<typeof setTimeout>|null} */
  let autoEndTimer = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let autoEndInterval = null;
  /** @type {string|null} */
  let autoEndNext = null;
  /** @type {number|null} Die index with an open re-face picker, or null. */
  let refacePickerIndex = null;

  /** Inline Continue — board stays visible, highlights only (no fade) */
  const INLINE_CONTINUE = {
    mountainsExplain: 'Six mountains numbered 5–10. A dice group that sums to that number climbs that mountain. 5–6 are tall (4 spaces); 9–10 are short (2 spaces).',
    tokens: 'Each colored circle is the mountain number. The × count is how many point tokens remain — a token is worth that mountain\'s number when you take the summit.',
    boardStart: 'Every goat starts at the foot (bottom) of each mountain. Yours and Rival\'s are highlighted below.',
    noticeUsed: 'Dice you already used this turn are dimmed and cannot be selected again.',
    firstToken: 'First summit! You took 1 point token from Mountain 10 — that adds 10 points to your score. The × count on that mountain dropped by 1.',
    rivalBump: 'Rival took your summit — you were bumped back to the foot. Only one goat holds a summit in Standard mode.',
    bonusSetup: 'Fast-forward: you already have a point token from mountains 5–9. Only mountain 10 is missing from your set. Claim it to earn a Bonus Token.',
  };

  /** Overlay Continue (before ones roll) */
  const OVERLAY_CONTINUE = {
    onesExplain: {
      icon: '1️⃣',
      title: 'Multiple 1s',
      body: 'If you roll more than one 1, keep one 1 and re-face extras to any face (1–6) with ↻. Then play this turn however you like — group dice and climb. When the turn ends, the tutorial continues.',
    },
  };

  const INFO_STEPS = {
    bonusClaimed: {
      icon: '✨',
      title: 'Bonus claimed!',
      body: 'You collected a token from all 6 mountains — a full set. That claims the highest Bonus Token (✨15). Later sets claim 12, then 9, then 6.',
    },
    ending: {
      icon: '🏁',
      title: 'How games end',
      body: 'The final round starts when all Bonus Tokens are claimed or 3 mountains run out of point tokens. Everyone gets equal turns, then most points wins. Ties: most goats on tops, then a goat on the higher-numbered mountain.',
    },
  };

  /** @type {string} */
  let stepId = 'intro';
  /** @type {object|null} */
  let state = null;
  /** @type {Set<number>} */
  let selected = new Set();
  let onExitHome = null;

  const $ = (id) => document.getElementById(id);

  function createState() {
    return {
      mountains: MOUNTAINS.map((m) => ({ ...m })),
      players: [
        {
          id: YOU_ID,
          name: 'You',
          color: '#5ad4ff',
          pos: MOUNTAINS.map(() => 0),
          score: 0,
          tops: 0,
          collected: MOUNTAINS.map(() => 0),
          bonus: [],
          bonusPoints: 0,
          sets: 0,
        },
        {
          id: RIVAL_ID,
          name: 'Rival',
          color: '#ff6b8a',
          pos: MOUNTAINS.map(() => 0),
          score: 0,
          tops: 0,
          collected: MOUNTAINS.map(() => 0),
          bonus: [],
          bonusPoints: 0,
          sets: 0,
        },
      ],
      rolled: false,
      dice: [null, null, null, null],
      diceUsed: [false, false, false, false],
      adjustable: [],
      numDice: 4,
      banner: '',
      bonusTokens: [15, 12, 9, 6],
      youSawBonusRow: false,
      refaceMountain: null,
    };
  }

  function you() {
    return state.players.find((p) => p.id === YOU_ID);
  }

  function rival() {
    return state.players.find((p) => p.id === RIVAL_ID);
  }

  /**
   * @param {string} id
   * @param {{ keepSelection?: boolean }} [opts]
   */
  function setStep(id, opts) {
    stepId = id;
    if (!(opts && opts.keepSelection)) selected.clear();
    render();
  }

  function clearAutoEndTimers() {
    if (autoEndTimer) clearTimeout(autoEndTimer);
    if (autoEndInterval) clearInterval(autoEndInterval);
    autoEndTimer = null;
    autoEndInterval = null;
  }

  /**
   * Teach that turns end when no 5–10 groups remain.
   * Tutorial never auto-advances — player must tap End Turn.
   * @param {string} nextStepId
   * @param {string} [message]
   */
  function beginAutoEnd(nextStepId, message) {
    clearAutoEndTimers();
    autoEndNext = nextStepId;
    state.banner = message || 'No groups of 5–10 left — tap End Turn.';
    setStep('autoEnd');
  }

  function finishAutoEnd() {
    clearAutoEndTimers();
    const next = autoEndNext;
    autoEndNext = null;
    if (!state) return;
    state.rolled = false;
    state.dice = [null, null, null, null];
    state.diceUsed = [false, false, false, false];
    state.adjustable = [];
    selected.clear();
    if (next === 'rivalBump') {
      applyRivalBump();
      setStep('rivalBump');
    } else if (next === 'bonusSetup') {
      setupBonusDemo();
      setStep('bonusSetup');
    }
  }

  function showPanel(which) {
    const intro = $('tut-intro');
    const cont = $('tut-continue-panel');
    const info = $('tut-info');
    const done = $('tut-done');
    [intro, cont, info, done].forEach((el) => {
      if (el) el.classList.remove('show');
    });
    if (which === 'intro' && intro) intro.classList.add('show');
    else if (which === 'continue' && cont) cont.classList.add('show');
    else if (which === 'info' && info) info.classList.add('show');
    else if (which === 'done' && done) done.classList.add('show');
  }

  function hidePanels() {
    showPanel(null);
  }

  function fillOverlayContinue() {
    const cfg = OVERLAY_CONTINUE[stepId];
    if (!cfg) return;
    const icon = $('tut-continue-icon');
    const title = $('tut-continue-title');
    const body = $('tut-continue-body');
    if (icon) icon.textContent = cfg.icon;
    if (title) title.textContent = cfg.title;
    if (body) body.textContent = cfg.body;
  }

  function fillInfoPanel() {
    const cfg = INFO_STEPS[stepId];
    if (!cfg) return;
    const icon = $('tut-info-icon');
    const title = $('tut-info-title');
    const body = $('tut-info-body');
    if (icon) icon.textContent = cfg.icon;
    if (title) title.textContent = cfg.title;
    if (body) body.textContent = cfg.body;
  }

  /**
   * @returns {string|null}
   */
  function activeTarget() {
    switch (stepId) {
      case 'intro': return 'start';
      case 'mountainsExplain':
      case 'boardStart':
      case 'tokens':
      case 'noticeUsed':
      case 'firstToken':
      case 'rivalBump':
      case 'onesExplain':
        return 'continue';
      case 'roll1':
      case 'roll2':
      case 'roll3':
        return 'roll';
      case 'sel4': return 'die-0';
      case 'sel6': return 'die-1';
      case 'climb1': return 'mountain-10';
      case 'sel5a': return 'die-2';
      case 'sel5b': return 'die-3';
      case 'summit': return 'mountain-10';
      case 'selH4': return 'die-0';
      case 'selH6': return 'die-1';
      case 'harvest': return 'mountain-10';
      case 'autoEnd': return 'endturn';
      case 'freeTurn': return 'free';
      case 'bonusSetup':
        return 'continue';
      case 'rollBonus': return 'roll';
      case 'selB4': return 'die-0';
      case 'selB6': return 'die-1';
      case 'climbBonus': return 'mountain-10';
      case 'bonusClaimed':
      case 'ending':
        return 'gotit';
      case 'done': return 'home';
      default: return null;
    }
  }

  function selectedSum() {
    let s = 0;
    selected.forEach((i) => { s += state.dice[i]; });
    return s;
  }

  /** Mountain index matching current selection sum, or -1. */
  function freeTargetMountain() {
    if (!selected.size) return -1;
    const sum = selectedSum();
    return state.mountains.findIndex((m) => m.value === sum);
  }

  /** True if unused dice can still form a 5–10 group (or adjustable 1s remain). */
  function freeAnyGroupPossible() {
    if (!state.dice) return false;
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

  /** @returns {number} mountain index for current mountain target, or -1 */
  function targetMountainIndex() {
    if (stepId === 'freeTurn') return freeTargetMountain();
    const t = activeTarget();
    if (!t || !t.startsWith('mountain-')) return -1;
    const value = parseInt(t.slice('mountain-'.length), 10);
    return state.mountains.findIndex((m) => m.value === value);
  }

  function coachText() {
    if (INLINE_CONTINUE[stepId]) return INLINE_CONTINUE[stepId];
    switch (stepId) {
      case 'intro': return 'Tap Start to begin.';
      case 'onesExplain': return 'Learn what happens when you roll multiple 1s.';
      case 'roll1': return 'Tap Roll Dice to roll your 4 dice.';
      case 'sel4': return 'Tap the die showing 4.';
      case 'sel6': return 'Tap the die showing 6. Groups that sum to 5–10 climb that mountain.';
      case 'climb1': return 'Mountain 10 is glowing — tap it to climb one space.';
      case 'sel5a': return 'Tap a die showing 5.';
      case 'sel5b': return 'Tap the other 5 to make another group of 10.';
      case 'summit': return 'Tap Mountain 10 to reach the summit and take a point token.';
      case 'roll2': return 'You are on the summit. Tap Roll Dice again.';
      case 'selH4': return 'Tap 4 — a matching group while on top harvests another token.';
      case 'selH6': return 'Tap 6 to finish the group of 10.';
      case 'harvest': return 'Tap Mountain 10 to harvest another point token.';
      case 'autoEnd': return (state && state.banner)
        ? state.banner + ' In a real game this wait auto-ends after 2 seconds.'
        : 'No groups of 5–10 remain. Tap End Turn.';
      case 'roll3': return 'Tap Roll Dice — you rolled two 1s.';
      case 'freeTurn': return 'Your turn — re-face 1s with ↻ if you want, group dice (sum 5–10), and climb. The turn ends when you have used all the dice you can.';
      case 'rollBonus': return 'Tap Roll Dice — finish the set on mountain 10.';
      case 'selB4': return 'Tap 4.';
      case 'selB6': return 'Tap 6 (4+6=10).';
      case 'climbBonus': return 'Tap Mountain 10 to take the last token and claim a Bonus!';
      case 'bonusClaimed': return 'You earned a Bonus Token.';
      case 'ending': return 'How a game ends and who wins.';
      case 'done': return 'Tutorial complete.';
      default: return '';
    }
  }

  function hintText() {
    if (
      stepId === 'climb1' || stepId === 'summit' || stepId === 'harvest'
      || stepId === 'climbBonus'
    ) {
      return 'Tap the glowing mountain to climb.';
    }
    if (stepId === 'freeTurn') {
      const tMi = freeTargetMountain();
      if (selected.size && tMi >= 0) return 'Tap the glowing mountain to climb.';
      if (selected.size) return 'Group = ' + selectedSum() + ' (need 5–10). Adjust your selection.';
      return 'Tap dice to group them, or ↻ to re-face extra 1s. End Turn when finished.';
    }
    if (stepId.startsWith('sel')) return 'Tap the highlighted die.';
    if (stepId === 'roll1' || stepId === 'roll2' || stepId === 'roll3' || stepId === 'rollBonus') {
      return 'Tap "Roll Dice" to roll.';
    }
    if (stepId === 'autoEnd') {
      return 'Tap "End Turn" to continue.';
    }
    if (INLINE_CONTINUE[stepId]) return 'Tap Continue when you understand.';
    return state && state.banner ? state.banner : '';
  }

  function goatCluster(players) {
    const wrap = document.createElement('div');
    wrap.className = 'goats';
    const turnId = (stepId === 'opponentTurn' || stepId === 'rivalBump') ? RIVAL_ID : YOU_ID;
    players.forEach((p) => {
      const g = document.createElement('div');
      g.className = 'goat'
        + (p.id === YOU_ID ? ' me' : '')
        + (p.id === turnId ? ' turn' : '');
      g.style.background = p.color;
      g.textContent = p.name.charAt(0).toUpperCase();
      g.title = p.name;
      wrap.appendChild(g);
    });
    return wrap;
  }

  function renderStats() {
    const strip = $('tut-stats-strip');
    if (!strip || !state) return;
    strip.innerHTML = state.players.map((p) => {
      const me = p.id === YOU_ID ? ' tut-you' : '';
      const bonusTag = p.bonusPoints
        ? `<span class="tut-stat-bonus">✨${p.bonusPoints}</span>`
        : '';
      return `<div class="tut-stat${me}" style="--c:${p.color}">
        <span class="tut-stat-dot"></span>
        <span class="tut-stat-name">${p.name}</span>
        ${bonusTag}
        <span class="tut-stat-score">⭐ ${p.score}</span>
      </div>`;
    }).join('');
  }

  function renderBonusRow() {
    const row = $('tut-bonus-row');
    if (!row || !state) return;
    const bonusPhase = stepId === 'bonusSetup' || stepId === 'rollBonus'
      || stepId === 'selB4' || stepId === 'selB6' || stepId === 'climbBonus'
      || stepId === 'bonusClaimed';
    if (!bonusPhase && !state.youSawBonusRow) {
      row.innerHTML = '';
      row.hidden = true;
      return;
    }
    const all = [15, 12, 9, 6];
    const remaining = new Set(state.bonusTokens || all.slice());
    row.hidden = false;
    row.innerHTML = '<span class="bonus-label">Bonus</span>' + all
      .map((v) => {
        if (remaining.has(v)) {
          return `<span class="bonus-tok">✨${v}</span>`;
        }
        const claimer = state.players.find((p) => (p.bonus || []).includes(v));
        const justClaimed = v === 15 ? ' tut-bonus-just-claimed' : '';
        if (claimer && claimer.color) {
          return `<span class="bonus-tok claimed${justClaimed}" style="--c:${claimer.color}">✨${v}</span>`;
        }
        return `<span class="bonus-tok gone${justClaimed}">✨${v}</span>`;
      })
      .join('');
  }

  function renderBoard() {
    const board = $('tut-board');
    if (!board || !state) return;
    board.innerHTML = '';
    const targetMi = targetMountainIndex();
    const glowMountains = stepId === 'mountainsExplain';
    const glowFeet = stepId === 'boardStart';
    const glowTokens = stepId === 'tokens';
    const glowFirstToken = stepId === 'firstToken';
    const freePlay = stepId === 'freeTurn';

    state.mountains.forEach((m, mi) => {
      const col = document.createElement('div');
      col.className = 'mcol';
      if (glowMountains) col.classList.add('tut-mountain-glow');
      if (glowTokens || (glowFirstToken && mi === MI_10)) col.classList.add('tut-token-glow');
      if (targetMi === mi) {
        const key = 'mountain-' + m.value;
        col.classList.add('target');
        col.setAttribute('data-tut-target', key);
        if (!freePlay) col.setAttribute('data-tut-active', '1');
      }
      const holders = state.players.filter((pl) => (pl.pos || [])[mi] >= m.height);
      const paint = (holders[0] && holders[0].color) || m.color;

      const head = document.createElement('div');
      head.className = 'mhead';
      head.innerHTML = `<span class="mtok" style="--c:${paint}">${m.value}</span>
        <span class="mleft">${m.chips > 0 ? '×' + m.chips : 'closed'}</span>`;
      const myCollected = (you() && you().collected[mi]) || 0;
      if (myCollected > 0) {
        head.insertAdjacentHTML('beforeend', `<span class="tut-have-tok">✓${myCollected}</span>`);
      }
      col.appendChild(head);

      const track = document.createElement('div');
      track.className = 'track';
      for (let p = m.height; p >= 1; p--) {
        const wrap = document.createElement('div');
        wrap.className = 'cell-wrap';
        const cell = document.createElement('div');
        cell.className = 'cell' + (p === m.height ? ' top' : '');
        cell.style.setProperty('--c', paint);
        cell.innerHTML = `<span class="cnum">${m.value}</span>`;
        const here = state.players.filter((pl) => (pl.pos || [])[mi] === p);
        if (here.length) cell.appendChild(goatCluster(here));
        wrap.appendChild(cell);
        track.appendChild(wrap);
      }
      col.appendChild(track);

      const foot = document.createElement('div');
      foot.className = 'foot' + (glowFeet ? ' tut-foot-glow' : '');
      const footGoats = state.players.filter((pl) => (pl.pos || [])[mi] === 0);
      if (footGoats.length) foot.appendChild(goatCluster(footGoats));
      col.appendChild(foot);

      if (targetMi === mi) {
        col.addEventListener('click', () => onMountainTap(mi));
      }
      board.appendChild(col);
    });
  }

  function renderDice() {
    const area = $('tut-dice-area');
    if (!area || !state) return;
    area.innerHTML = '';
    const target = activeTarget();
    const freePlay = stepId === 'freeTurn';

    if (!state.rolled) {
      for (let i = 0; i < state.numDice; i++) {
        const d = document.createElement('div');
        d.className = 'die';
        d.textContent = '🎲';
        area.appendChild(d);
      }
      return;
    }

    const noneUsed = !state.diceUsed.some((u) => u);
    if (
      refacePickerIndex != null
      && !(noneUsed && state.adjustable && state.adjustable.includes(refacePickerIndex))
    ) {
      refacePickerIndex = null;
    }

    state.dice.forEach((v, i) => {
      const d = document.createElement('div');
      const used = !!state.diceUsed[i];
      d.className = 'die'
        + (used ? ' used tut-die-used' : '')
        + (selected.has(i) ? ' sel' : '');
      d.textContent = v;

      const dieKey = 'die-' + i;
      if (freePlay && !used) {
        d.setAttribute('data-tut-target', dieKey);
        d.addEventListener('click', () => onDieTap(i));
      } else if (target === dieKey && !used) {
        d.setAttribute('data-tut-target', dieKey);
        d.setAttribute('data-tut-active', '1');
        d.addEventListener('click', () => onDieTap(i));
      }

      if (
        noneUsed
        && state.adjustable
        && state.adjustable.includes(i)
        && (freePlay)
      ) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reface';
        btn.textContent = '↻';
        btn.title = 'Change this die face';
        btn.setAttribute('data-tut-target', 'reface-' + i);
        btn.setAttribute('aria-expanded', refacePickerIndex === i ? 'true' : 'false');
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          refacePickerIndex = refacePickerIndex === i ? null : i;
          render();
        });
        d.appendChild(btn);
      }

      area.appendChild(d);
    });

    if (refacePickerIndex != null && freePlay) {
      const index = refacePickerIndex;
      const current = state.dice[index];
      const picker = document.createElement('div');
      picker.className = 'reface-picker';
      picker.setAttribute('role', 'listbox');
      picker.setAttribute('aria-label', 'Choose die face');
      picker.addEventListener('click', (e) => e.stopPropagation());
      for (let face = 1; face <= 6; face++) {
        const opt = document.createElement('button');
        opt.type = 'button';
        opt.className = 'reface-face' + (face === current ? ' is-current' : '');
        opt.textContent = String(face);
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          onReface(index, face);
        });
        picker.appendChild(opt);
      }
      area.appendChild(picker);
    }
  }

  function renderInlineContinue() {
    const wrap = $('tut-inline-continue-wrap');
    if (!wrap) return;
    const show = !!INLINE_CONTINUE[stepId];
    wrap.hidden = !show;
    if (show) {
      const btn = $('tut-btn-inline-continue');
      if (btn) btn.setAttribute('data-tut-active', '1');
    }
  }

  function renderControls() {
    const rollBtn = $('tut-btn-roll');
    if (rollBtn) {
      const needRoll = activeTarget() === 'roll';
      rollBtn.disabled = !needRoll;
      if (needRoll) rollBtn.setAttribute('data-tut-active', '1');
      else rollBtn.removeAttribute('data-tut-active');
    }

    const endBtn = $('tut-btn-endturn');
    if (endBtn) {
      const needEnd = activeTarget() === 'endturn' || stepId === 'freeTurn';
      endBtn.disabled = !needEnd;
      if (needEnd) endBtn.setAttribute('data-tut-active', '1');
      else endBtn.removeAttribute('data-tut-active');
    }

    const sumEl = $('tut-sel-sum');
    if (sumEl) {
      if (selected.size) {
        const sum = selectedSum();
        const tMi = freeTargetMountain();
        sumEl.textContent = tMi >= 0
          ? `Group = ${sum} → Mountain ${sum}`
          : `Group = ${sum}` + (sum >= 5 && sum <= 10 ? '' : ' (need 5–10)');
        sumEl.classList.toggle('ok', tMi >= 0);
      } else {
        sumEl.textContent = '';
        sumEl.classList.remove('ok');
      }
    }

    const hint = $('tut-hint');
    if (hint) hint.textContent = hintText();

    const coach = $('tut-coach');
    if (coach) coach.textContent = coachText();

    const banner = $('tut-turn-banner');
    if (banner) {
      if (stepId === 'rivalBump') banner.textContent = 'Rival\'s turn';
      else if (stepId === 'autoEnd' && state && state.banner) banner.textContent = state.banner;
      else if (state && state.banner) banner.textContent = state.banner;
      else banner.textContent = 'Your turn';
    }

    renderInlineContinue();
  }

  function applySpotlight() {
    const screen = $('screen-tutorial');
    if (!screen) return;
    const key = activeTarget();
    screen.setAttribute('data-tut-step', stepId || '');
    if (stepId === 'freeTurn') {
      // Free play — no spotlight gating.
      screen.querySelectorAll('[data-tut-active]').forEach((el) => el.removeAttribute('data-tut-active'));
      return;
    }
    screen.querySelectorAll('[data-tut-active]').forEach((el) => {
      if (el.getAttribute('data-tut-target') !== key) {
        el.removeAttribute('data-tut-active');
      }
    });
    if (key === 'start' || key === 'continue' || key === 'gotit' || key === 'home') {
      const btns = screen.querySelectorAll('[data-tut-target="' + key + '"]');
      btns.forEach((btn) => {
        if (!btn.closest('[hidden]')) btn.setAttribute('data-tut-active', '1');
      });
    }
  }

  function render() {
    if (!state) return;
    if (stepId === 'intro') showPanel('intro');
    else if (OVERLAY_CONTINUE[stepId]) {
      fillOverlayContinue();
      showPanel('continue');
    } else if (INFO_STEPS[stepId]) {
      fillInfoPanel();
      showPanel('info');
    } else if (stepId === 'done') showPanel('done');
    else hidePanels();

    renderStats();
    renderBonusRow();
    renderBoard();
    renderDice();
    renderControls();
    applySpotlight();
  }

  function onDieTap(index) {
    if (state.diceUsed[index]) return;

    if (stepId === 'freeTurn') {
      if (selected.has(index)) selected.delete(index);
      else selected.add(index);
      render();
      return;
    }

    const target = activeTarget();
    if (target !== 'die-' + index) return;
    selected.add(index);

    if (stepId === 'sel4') setStep('sel6', { keepSelection: true });
    else if (stepId === 'sel6') setStep('climb1', { keepSelection: true });
    else if (stepId === 'sel5a') setStep('sel5b', { keepSelection: true });
    else if (stepId === 'sel5b') setStep('summit', { keepSelection: true });
    else if (stepId === 'selH4') setStep('selH6', { keepSelection: true });
    else if (stepId === 'selH6') setStep('harvest', { keepSelection: true });
    else if (stepId === 'selB4') setStep('selB6', { keepSelection: true });
    else if (stepId === 'selB6') setStep('climbBonus', { keepSelection: true });
    else render();
  }

  /**
   * @param {number} mi
   */
  function onMountainTap(mi) {
    const targetMi = targetMountainIndex();
    if (targetMi < 0 || mi !== targetMi) return;
    const me = you();
    const m = state.mountains[mi];

    if (stepId === 'climb1') {
      me.pos[MI_10] = 1;
      selected.forEach((i) => { state.diceUsed[i] = true; });
      selected.clear();
      state.banner = 'Climbed one space!';
      setStep('noticeUsed');
      return;
    }

    if (stepId === 'summit') {
      me.pos[MI_10] = m.height;
      if (m.chips > 0) {
        m.chips -= 1;
        me.collected[MI_10] += 1;
        me.score += m.value;
      }
      me.tops = 1;
      selected.forEach((i) => { state.diceUsed[i] = true; });
      selected.clear();
      state.rolled = false;
      state.adjustable = [];
      state.banner = 'Summit! +10 points, token taken.';
      setStep('firstToken');
      return;
    }

    if (stepId === 'harvest') {
      if (m.chips > 0) {
        m.chips -= 1;
        me.collected[MI_10] += 1;
        me.score += m.value;
      }
      selected.forEach((i) => { state.diceUsed[i] = true; });
      selected.clear();
      state.banner = 'Harvested — leftover 1 and 2 cannot make 5–10.';
      beginAutoEnd('rivalBump', '1 + 2 = 3 — not a valid group (need 5–10). Tap End Turn.');
      return;
    }

    if (stepId === 'freeTurn') {
      applyFreeClimb(mi);
      return;
    }

    if (stepId === 'climbBonus') {
      me.pos[MI_10] = m.height;
      if (m.chips > 0) {
        m.chips -= 1;
        me.collected[MI_10] += 1;
        me.score += m.value;
      }
      me.tops = 1;
      // Full set → claim highest bonus token
      const bonusVal = 15;
      state.bonusTokens = (state.bonusTokens || []).filter((v) => v !== bonusVal);
      me.bonus = [bonusVal];
      me.bonusPoints = bonusVal;
      me.sets = 1;
      me.score += bonusVal;
      selected.forEach((i) => { state.diceUsed[i] = true; });
      selected.clear();
      state.banner = 'Full set! Bonus ✨15 claimed.';
      setStep('bonusClaimed');
    }
  }

  /**
   * Apply one free-play climb using the current dice selection.
   * @param {number} mi
   */
  function applyFreeClimb(mi) {
    const me = you();
    const m = state.mountains[mi];
    if (freeTargetMountain() !== mi) return;

    const prev = me.pos[mi] || 0;
    const next = Math.min(prev + 1, m.height);

    if (next === m.height) {
      state.players.forEach((p) => {
        if (p.id !== me.id && (p.pos[mi] || 0) >= m.height) p.pos[mi] = 0;
      });
    }
    me.pos[mi] = next;

    if (next === m.height && m.chips > 0) {
      m.chips -= 1;
      me.collected[mi] = (me.collected[mi] || 0) + 1;
      me.score += m.value;
    }
    me.tops = state.mountains.reduce(
      (acc, mt, i) => acc + ((me.pos[i] || 0) >= mt.height ? 1 : 0),
      0
    );

    selected.forEach((i) => { state.diceUsed[i] = true; });
    selected.clear();
    if (state.diceUsed.some((u) => u)) state.adjustable = [];
    state.banner = next === m.height
      ? ('Token from Mountain ' + m.value + '!')
      : ('Climbed Mountain ' + m.value + '.');
    render();
    if (!freeAnyGroupPossible()) {
      const allUsed = state.diceUsed.every((u) => u);
      beginAutoEnd(
        'bonusSetup',
        allUsed
          ? 'You used all your dice — the turn ends. Tap End Turn.'
          : 'You used every dice group you could — the turn ends. Tap End Turn.'
      );
    }
  }

  /**
   * Jump ahead: tokens from mountains 5–9 already collected; mountain 10 one step from summit.
   */
  function setupBonusDemo() {
    const me = you();
    const opp = rival();
    const m10 = state.mountains[MI_10];
    me.collected = [1, 1, 1, 1, 1, 0];
    me.score = 5 + 6 + 7 + 8 + 9;
    me.pos = MOUNTAINS.map((m, i) => (i === MI_10 ? m.height - 1 : 0));
    me.tops = 0;
    me.bonus = [];
    me.bonusPoints = 0;
    me.sets = 0;
    opp.pos = MOUNTAINS.map(() => 0);
    opp.collected = MOUNTAINS.map(() => 0);
    opp.score = 0;
    opp.tops = 0;
    opp.bonus = [];
    opp.bonusPoints = 0;
    state.bonusTokens = [15, 12, 9, 6];
    state.rolled = false;
    state.dice = [null, null, null, null];
    state.diceUsed = [false, false, false, false];
    state.adjustable = [];
    state.banner = 'One step from summit on mountain 10.';
    state.youSawBonusRow = true;
    // Ensure mountain 10 still has chips
    if (m10.chips < 1) m10.chips = 3;
  }

  function onRoll() {
    if (activeTarget() !== 'roll') return;
    const area = $('tut-dice-area');
    if (area) {
      area.classList.add('rolling');
      setTimeout(() => area.classList.remove('rolling'), 450);
    }

    if (stepId === 'roll1') {
      state.rolled = true;
      state.dice = [4, 6, 5, 5];
      state.diceUsed = [false, false, false, false];
      state.adjustable = [];
      state.banner = '';
      setStep('sel4');
      return;
    }

    if (stepId === 'roll2') {
      state.rolled = true;
      state.dice = [4, 6, 1, 2];
      state.diceUsed = [false, false, false, false];
      state.adjustable = [];
      state.banner = 'Already on top — matching group harvests.';
      setStep('selH4');
      return;
    }

    if (stepId === 'roll3') {
      state.rolled = true;
      state.dice = [1, 1, 4, 5];
      state.diceUsed = [false, false, false, false];
      state.adjustable = [1];
      state.banner = 'Free turn — re-face, group, and climb as you like.';
      setStep('freeTurn');
      return;
    }

    if (stepId === 'rollBonus') {
      state.rolled = true;
      state.dice = [4, 6, 2, 3];
      state.diceUsed = [false, false, true, true];
      state.adjustable = [];
      state.banner = 'Group 4+6 to finish mountain 10.';
      setStep('selB4');
    }
  }

  function onEndTurn() {
    if (stepId === 'freeTurn') {
      clearAutoEndTimers();
      autoEndNext = 'bonusSetup';
      finishAutoEnd();
      return;
    }
    if (activeTarget() !== 'endturn') return;
    if (stepId === 'autoEnd') {
      finishAutoEnd();
    }
  }

  function applyRivalBump() {
    const me = you();
    const opp = rival();
    const m = state.mountains[MI_10];
    me.pos[MI_10] = 0;
    me.tops = 0;
    opp.pos[MI_10] = m.height;
    opp.tops = 1;
    if (m.chips > 0) {
      m.chips -= 1;
      opp.collected[MI_10] += 1;
      opp.score += m.value;
    }
    state.banner = 'Rival claimed the summit!';
  }

  /**
   * Re-face an extra 1 (may change again until a climb; matches live adjustDie).
   *
   * @param {number} index Die index.
   * @param {number} face Target face 1-6.
   * @returns {void}
   */
  function onReface(index, face) {
    if (stepId !== 'freeTurn') return;
    if (!state.adjustable || !state.adjustable.includes(index)) return;
    const noneUsed = !state.diceUsed.some((u) => u);
    if (!noneUsed) return;
    const next = Number(face);
    if (!(next >= 1 && next <= 6)) return;
    state.dice[index] = next;
    refacePickerIndex = null;
    state.banner = 'Re-faced to ' + next + '.';
    render();
  }

  function onContinue() {
    if (activeTarget() !== 'continue') return;
    if (stepId === 'mountainsExplain') setStep('tokens');
    else if (stepId === 'tokens') setStep('boardStart');
    else if (stepId === 'boardStart') setStep('roll1');
    else if (stepId === 'noticeUsed') setStep('sel5a');
    else if (stepId === 'firstToken') setStep('roll2');
    else if (stepId === 'rivalBump') setStep('onesExplain');
    else if (stepId === 'onesExplain') setStep('roll3');
    else if (stepId === 'bonusSetup') setStep('rollBonus');
  }

  function onGotIt() {
    if (activeTarget() !== 'gotit') return;
    if (stepId === 'bonusClaimed') setStep('ending');
    else if (stepId === 'ending') setStep('done');
  }

  function bindOnce() {
    if (bindOnce.done) return;
    bindOnce.done = true;

    const roll = $('tut-btn-roll');
    if (roll) roll.addEventListener('click', onRoll);

    const endTurn = $('tut-btn-endturn');
    if (endTurn) endTurn.addEventListener('click', onEndTurn);

    const start = $('tut-btn-start');
    if (start) {
      start.addEventListener('click', () => {
        if (stepId !== 'intro') return;
        hidePanels();
        setStep('mountainsExplain');
      });
    }

    const cont = $('tut-btn-continue');
    if (cont) cont.addEventListener('click', onContinue);

    const inlineCont = $('tut-btn-inline-continue');
    if (inlineCont) inlineCont.addEventListener('click', onContinue);

    const gotit = $('tut-btn-gotit');
    if (gotit) gotit.addEventListener('click', onGotIt);

    const home = $('tut-btn-home');
    if (home) {
      home.addEventListener('click', () => {
        if (stepId !== 'done') return;
        exit();
      });
    }

    const exitBtn = $('tut-exit');
    if (exitBtn) exitBtn.addEventListener('click', exit);
  }

  function exit() {
    clearAutoEndTimers();
    autoEndNext = null;
    state = null;
    selected.clear();
    stepId = 'intro';
    hidePanels();
    const wrap = $('tut-inline-continue-wrap');
    if (wrap) wrap.hidden = true;
    if (typeof onExitHome === 'function') onExitHome();
  }

  /**
   * Start or restart the tutorial.
   * @param {{ showScreen: function(string): void, goHome: function(): void }} api
   */
  function start(api) {
    bindOnce();
    clearAutoEndTimers();
    autoEndNext = null;
    onExitHome = api && api.goHome ? api.goHome : null;
    state = createState();
    selected.clear();
    stepId = 'intro';
    if (api && typeof api.showScreen === 'function') api.showScreen('tutorial');
    render();
  }

  window.MGTutorial = { start, exit };
})();
