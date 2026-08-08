/**
 * Bundled sound effects for Mountain Goats (WAV + OGG Kenney CC0 clips).
 * Uses a small HTMLAudioElement pool per clip (no cloneNode) to cut play latency.
 */
(function () {
  const STORAGE_KEY = 'mg_sound_enabled';
  const MASTER_VOLUME = 0.5;
  const OTHER_VOLUME = 0.35;
  const POOL_SIZE = 3;

  const CLIPS = {
    ui_tap: '/audio/ui-tap.wav',
    dice_roll: '/audio/dice-roll.ogg',
    dice_adjust: '/audio/dice-adjust.ogg',
    summit: '/audio/summit.wav',
    bump: '/audio/bump.ogg',
    bonus: '/audio/bonus.wav',
    final_round: '/audio/final-round.wav',
    your_turn: '/audio/your-turn.wav',
    game_start: '/audio/game-start.wav',
    game_end_win: '/audio/win.wav',
    game_end_loss: '/audio/lose.wav',
  };

  let enabled = true;
  let unlocked = false;
  /** @type {Map<string, { instances: HTMLAudioElement[], next: number }>} */
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
   * Ensure a pool of preloaded Audio elements exists for a clip.
   *
   * @param {string} src Clip URL.
   * @returns {{ instances: HTMLAudioElement[], next: number }}
   */
  function ensurePool(src) {
    if (!pool.has(src)) {
      const instances = [];
      for (let i = 0; i < POOL_SIZE; i += 1) {
        const audio = new Audio(src);
        audio.preload = 'auto';
        instances.push(audio);
      }
      pool.set(src, { instances, next: 0 });
    }
    return pool.get(src);
  }

  /**
   * Take the next pooled Audio for overlapping plays of the same clip.
   *
   * @param {string} src Clip URL.
   * @returns {HTMLAudioElement}
   */
  function takePooledAudio(src) {
    const entry = ensurePool(src);
    const audio = entry.instances[entry.next];
    entry.next = (entry.next + 1) % entry.instances.length;
    return audio;
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
      const audio = takePooledAudio(src);
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (err) {
        /* ignore seek errors before metadata */
      }
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
   * Silently prime one Audio element so the OS unlocks playback.
   *
   * @param {HTMLAudioElement} audio Element to prime.
   * @returns {void}
   */
  function primeAudio(audio) {
    const prevVolume = audio.volume;
    audio.volume = 0.001;
    const promise = audio.play();
    if (promise && typeof promise.then === 'function') {
      promise.then(() => {
        audio.pause();
        try { audio.currentTime = 0; } catch (err) { /* ignore */ }
        audio.volume = prevVolume;
      }).catch(() => {
        audio.volume = prevVolume;
      });
    } else {
      audio.volume = prevVolume;
    }
  }

  /**
   * Prime all clip pools on first user gesture (mobile autoplay policy).
   *
   * @returns {void}
   */
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    Object.values(CLIPS).forEach((src) => {
      const entry = ensurePool(src);
      entry.instances.forEach((audio) => {
        primeAudio(audio);
      });
    });
  }

  /**
   * Localized sound toggle label.
   *
   * @param {boolean} on Whether sound is enabled.
   * @returns {string}
   */
  function soundToggleLabel(on) {
    const key = on ? 'settings.soundOn' : 'settings.soundOff';
    return window.t ? window.t(key) : (on ? 'Sound on' : 'Sound off');
  }

  /**
   * @param {boolean} on
   * @returns {void}
   */
  function syncToggleButtons(on) {
    const label = soundToggleLabel(on);
    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
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
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return true;
      return raw === 'true';
    } catch (err) {
      return true;
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
      ensurePool(src);
    });

    syncToggleButtons(enabled);

    document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        unlock();
        setEnabled(!enabled);
        if (enabled) play({ type: 'ui_tap', self: true });
      });
    });

    const unlockOnce = () => {
      unlock();
      document.removeEventListener('pointerdown', unlockOnce, true);
      document.removeEventListener('keydown', unlockOnce, true);
    };
    document.addEventListener('pointerdown', unlockOnce, true);
    document.addEventListener('keydown', unlockOnce, true);

    document.addEventListener('mg:localechange', () => {
      syncToggleButtons(enabled);
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
