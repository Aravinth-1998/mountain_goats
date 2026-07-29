/**
 * Mobile haptic feedback for Mountain Goats (navigator.vibrate).
 */
(function () {
  const STORAGE_KEY = 'mg_haptics_enabled';

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

  let enabled = false;

  /**
   * @returns {boolean}
   */
  function canVibrate() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
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
    return enabled && canVibrate() && !isReducedMotion();
  }

  /**
   * @param {number|number[]} pattern
   * @returns {void}
   */
  function runPattern(pattern) {
    if (!isActive()) return;
    navigator.vibrate(0);
    navigator.vibrate(pattern);
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function syncToggleButtons(on) {
    document.querySelectorAll('[data-haptics-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.classList.toggle('is-off', !on);
      button.title = on ? 'Haptics on' : 'Haptics off';
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
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (err) {
      return false;
    }
  }

  /**
   * Bind haptics toggle buttons.
   *
   * @returns {void}
   */
  function init() {
    enabled = readStoredEnabled();

    syncToggleButtons(enabled);

    document.querySelectorAll('[data-haptics-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        setEnabled(!enabled);
        if (enabled) trigger({ type: 'ui_tap', self: true });
      });
    });
  }

  window.MGHaptics = {
    init,
    trigger,
    setEnabled,
    getEnabled,
    canVibrate,
  };
})();
