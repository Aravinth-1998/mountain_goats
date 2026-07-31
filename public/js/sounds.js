/**
 * Bundled MP3 sound effects for Mountain Goats.
 */
(function () {
  const STORAGE_KEY = 'mg_sound_enabled';
  const MASTER_VOLUME = 0.5;
  const OTHER_VOLUME = 0.35;

  const CLIPS = {
    ui_tap: '/audio/ui-tap.wav',
    dice_roll: '/audio/dice-roll.wav',
    dice_adjust: '/audio/dice-adjust.wav',
    summit: '/audio/summit.wav',
    bump: '/audio/bump.wav',
    bonus: '/audio/bonus.wav',
    final_round: '/audio/final-round.wav',
    your_turn: '/audio/your-turn.wav',
    game_start: '/audio/game-start.wav',
    game_end_win: '/audio/win.wav',
    game_end_loss: '/audio/lose.wav',
  };

  let enabled = false;
  let unlocked = false;
  const pool = new Map();

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
    return enabled && !isReducedMotion();
  }

  /**
   * @param {string} src
   * @returns {HTMLAudioElement}
   */
  function getBaseAudio(src) {
    if (!pool.has(src)) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      pool.set(src, audio);
    }
    return pool.get(src);
  }

  /**
   * @param {string} src
   * @param {number} volume
   * @param {number} [delayMs]
   * @returns {void}
   */
  function playClip(src, volume, delayMs) {
    if (!isActive() || !src) return;

    const play = () => {
      const base = getBaseAudio(src);
      const audio = base.cloneNode();
      audio.volume = Math.max(0, Math.min(1, volume));
      const promise = audio.play();
      if (promise && typeof promise.catch === 'function') {
        promise.catch(() => {});
      }
    };

    if (delayMs > 0) {
      window.setTimeout(play, delayMs);
    } else {
      play();
    }
  }

  /**
   * Prime audio on first user gesture (mobile autoplay policy).
   *
   * @returns {void}
   */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    const src = CLIPS.ui_tap;
    if (!src) return;
    const audio = getBaseAudio(src);
    const prevVolume = audio.volume;
    audio.volume = 0.001;
    const promise = audio.play();
    if (promise && typeof promise.then === 'function') {
      promise.then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = prevVolume;
      }).catch(() => {});
    }
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function syncToggleButtons(on) {
    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.classList.toggle('is-off', !on);
      button.title = on ? 'Sound on' : 'Sound off';
      button.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
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
   * @param {{type: string, self?: boolean, victimId?: string|null}} event
   * @param {{didWin?: boolean, myId?: string|null}} [options]
   * @returns {void}
   */
  function play(event, options) {
    if (!event || !event.type) return;
    const opts = options || {};
    const myId = opts.myId != null ? opts.myId : null;
    const selfVol = MASTER_VOLUME;
    const otherVol = MASTER_VOLUME * OTHER_VOLUME;

    switch (event.type) {
      case 'ui_tap':
        playClip(CLIPS.ui_tap, selfVol);
        break;
      case 'dice_roll':
        playClip(CLIPS.dice_roll, event.self ? selfVol : otherVol);
        break;
      case 'dice_adjust':
        if (event.self) playClip(CLIPS.dice_adjust, selfVol);
        break;
      case 'summit':
        playClip(CLIPS.summit, event.self ? selfVol : otherVol);
        break;
      case 'bump':
        if (event.victimId && myId && event.victimId === myId) {
          playClip(CLIPS.bump, selfVol);
        } else {
          playClip(CLIPS.bump, otherVol);
        }
        break;
      case 'bonus':
        playClip(CLIPS.bonus, event.self ? selfVol : otherVol);
        break;
      case 'final_round':
        playClip(CLIPS.final_round, selfVol);
        break;
      case 'your_turn':
        playClip(CLIPS.your_turn, selfVol);
        break;
      case 'game_start':
        playClip(CLIPS.game_start, selfVol);
        break;
      case 'game_end':
        playClip(opts.didWin ? CLIPS.game_end_win : CLIPS.game_end_loss, selfVol);
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
   * Preload clips and bind toggle buttons.
   *
   * @returns {void}
   */
  function init() {
    enabled = readStoredEnabled();

    Object.values(CLIPS).forEach((src) => {
      getBaseAudio(src);
    });

    syncToggleButtons(enabled);

    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        unlock();
        setEnabled(!enabled);
        if (enabled) play({ type: 'ui_tap', self: true });
      });
    });
  }

  window.MGSounds = {
    init,
    unlock,
    play,
    setEnabled,
    getEnabled,
  };
})();
