/**
 * Mobile haptic feedback for Mountain Goats (navigator.vibrate + iOS overlay ticks).
 * On iOS, tap haptics come from MGTactus overlays; async game events are no-op.
 */
(function () {
  const STORAGE_KEY = 'mg_haptics_enabled';

  const STATIC_SELECTORS = [
    '[data-haptics-toggle]',
    '#btn-roll',
    '#btn-endturn',
    '#tut-btn-roll',
    '#tut-btn-endturn',
  ];

  const PATTERNS = {
    ui_tap: 12,
    dice_roll_self: [15, 30, 15],
    dice_roll_other: 10,
    dice_adjust: 10,
    summit_self: 25,
    summit_other: 12,
    bump_victim: [40, 20, 40],
    bump_other: 20,
    bonus_self: [20, 40, 20],
    bonus_other: [15, 25, 15],
    final_round: [30, 50, 30],
    your_turn: 15,
    game_end_win: [30, 50, 30, 50, 80],
    game_end_loss: [25, 40],
    game_start: [20, 30, 20],
  };

  let enabled = true;

  /**
   * @returns {boolean}
   */
  function canVibrate() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  /**
   * @returns {boolean}
   */
  function isIOSHaptics() {
    return !!(window.MGTactus && typeof window.MGTactus.isIOS === 'function' && window.MGTactus.isIOS());
  }

  /**
   * True when vibrate or iOS overlay haptics are available.
   *
   * @returns {boolean}
   */
  function canHaptic() {
    return canVibrate() || isIOSHaptics();
  }

  /**
   * @returns {boolean}
   */
  function isReducedMotion() {
    return typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /**
   * @returns {boolean}
   */
  function isActive() {
    return enabled && canHaptic() && !isReducedMotion();
  }

  /**
   * Whether iOS overlay switches should be present.
   *
   * @returns {boolean}
   */
  function iosOverlaysActive() {
    return enabled && isIOSHaptics() && !isReducedMotion()
      && window.MGTactus
      && typeof window.MGTactus.bindHapticTarget === 'function';
  }

  /**
   * Bind or clear static control overlays (roll, end turn, settings toggle).
   *
   * @returns {void}
   */
  function syncStaticOverlays() {
    if (!window.MGTactus) return;
    const bind = window.MGTactus.bindHapticTarget;
    const unbind = window.MGTactus.unbindHapticTarget;
    if (typeof bind !== 'function' || typeof unbind !== 'function') return;

    STATIC_SELECTORS.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (iosOverlaysActive()) bind(el);
        else unbind(el);
      });
    });
  }

  /**
   * Bind interactive dice under a root after they are re-rendered.
   *
   * @param {ParentNode|null|undefined} root Dice container (#dice-area or #tut-dice-area).
   * @returns {void}
   */
  function syncDiceOverlays(root) {
    if (!window.MGTactus || !root || !root.querySelectorAll) return;
    const bind = window.MGTactus.bindHapticTarget;
    const unbind = window.MGTactus.unbindHapticTarget;
    if (typeof bind !== 'function' || typeof unbind !== 'function') return;

    root.querySelectorAll('.die').forEach((die) => {
      const placeholder = die.classList.contains('die-placeholder') || die.textContent === '🎲';
      const interactive = iosOverlaysActive()
        && !placeholder
        && !die.classList.contains('used')
        && !die.classList.contains('tut-die-used');
      if (interactive) bind(die);
      else unbind(die);
    });
  }

  /**
   * Show iOS-limited Settings note when relevant.
   *
   * @returns {void}
   */
  function syncIosHint() {
    const hint = document.getElementById('settings-haptics-ios-hint');
    if (!hint) return;
    hint.hidden = !isIOSHaptics();
  }

  /**
   * @param {number|number[]} pattern
   * @returns {void}
   */
  function runPattern(pattern) {
    if (!isActive()) return;
    // iOS: tap ticks come from overlays only; async emit paths are silent.
    if (isIOSHaptics()) return;
    if (!canVibrate()) return;
    navigator.vibrate(0);
    navigator.vibrate(pattern);
  }

  /**
   * Localized haptics toggle label.
   *
   * @param {boolean} on Whether haptics are enabled.
   * @returns {string}
   */
  function hapticsToggleLabel(on) {
    const key = on ? 'settings.hapticsOn' : 'settings.hapticsOff';
    return window.t ? window.t(key) : (on ? 'Haptics on' : 'Haptics off');
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function syncToggleButtons(on) {
    const label = hapticsToggleLabel(on);
    document.querySelectorAll('[data-haptics-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.classList.toggle('is-off', !on);
      button.title = label;
      button.setAttribute('aria-label', label);
    });
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function setEnabled(on) {
    enabled = !!on;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (err) {
      // ignore storage errors
    }
    syncToggleButtons(enabled);
    syncStaticOverlays();
    syncDiceOverlays(document.getElementById('dice-area'));
    syncDiceOverlays(document.getElementById('tut-dice-area'));
  }

  /**
   * @returns {boolean}
   */
  function getEnabled() {
    return enabled;
  }

  /**
   * @param {{type: string, self?: boolean, victimId?: string|null, actorId?: string|null}} event
   * @param {{didWin?: boolean, myId?: string|null}} [options]
   * @returns {void}
   */
  function trigger(event, options) {
    if (!event || !event.type) return;
    const opts = options || {};
    const myId = opts.myId != null ? opts.myId : null;

    switch (event.type) {
      case 'ui_tap':
        runPattern(PATTERNS.ui_tap);
        break;
      case 'dice_roll':
        runPattern(event.self ? PATTERNS.dice_roll_self : PATTERNS.dice_roll_other);
        break;
      case 'dice_adjust':
        if (event.self) runPattern(PATTERNS.dice_adjust);
        break;
      case 'summit':
        runPattern(event.self ? PATTERNS.summit_self : PATTERNS.summit_other);
        break;
      case 'bump':
        if (event.victimId && myId && event.victimId === myId) {
          runPattern(PATTERNS.bump_victim);
        } else {
          runPattern(PATTERNS.bump_other);
        }
        break;
      case 'bonus':
        runPattern(event.self ? PATTERNS.bonus_self : PATTERNS.bonus_other);
        break;
      case 'final_round':
        runPattern(PATTERNS.final_round);
        break;
      case 'your_turn':
        runPattern(PATTERNS.your_turn);
        break;
      case 'game_start':
        runPattern(PATTERNS.game_start);
        break;
      case 'game_end':
        runPattern(opts.didWin ? PATTERNS.game_end_win : PATTERNS.game_end_loss);
        break;
      default:
        break;
    }
  }

  /**
   * @returns {boolean}
   */
  function readStoredEnabled() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return true;
      return raw === 'true';
    } catch (err) {
      return true;
    }
  }

  /**
   * Bind haptics toggle buttons and iOS overlays.
   *
   * @returns {void}
   */
  function init() {
    enabled = readStoredEnabled();

    syncToggleButtons(enabled);
    syncIosHint();
    syncStaticOverlays();
    syncDiceOverlays(document.getElementById('dice-area'));
    syncDiceOverlays(document.getElementById('tut-dice-area'));

    document.querySelectorAll('[data-haptics-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        setEnabled(!enabled);
      });
    });

    document.addEventListener('mg:localechange', () => {
      syncToggleButtons(enabled);
      syncIosHint();
    });
  }

  window.MGHaptics = {
    init,
    trigger,
    setEnabled,
    getEnabled,
    canVibrate,
    canHaptic,
    syncDiceOverlays,
    syncStaticOverlays,
  };
})();
