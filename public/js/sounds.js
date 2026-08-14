/**
 * Bundled sound effects for Mountain Goats.
 * Uses Web Audio API (predecoded buffers) for low-latency mobile playback.
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
    other_turn: '/audio/others-turn.mp3',
    end_turn: '/audio/end-turn-button.mp3',
    leave_click: '/audio/exit-leave-icon-click.mp3',
    player_join: '/audio/when-player-joins-lobby.mp3',
    mountain_closed: '/audio/when-second-mountain-is-closed.mp3',
  };

  let enabled = true;
  let unlocked = false;
  /** @type {AudioContext|null} */
  let audioCtx = null;
  /** @type {Map<string, AudioBuffer>} */
  const buffers = new Map();
  /** @type {Promise<void>|null} */
  let loadPromise = null;

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
   * Create or return the shared AudioContext.
   *
   * @returns {AudioContext|null}
   */
  function getAudioContext() {
    if (audioCtx) return audioCtx;
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  }

  /**
   * Fetch and decode one clip into the buffer map.
   *
   * @param {string} src Clip URL.
   * @param {AudioContext} ctx Web Audio context.
   * @returns {Promise<void>}
   */
  async function decodeClip(src, ctx) {
    if (buffers.has(src)) return;
    const res = await fetch(src);
    if (!res.ok) throw new Error('Failed to load ' + src);
    const data = await res.arrayBuffer();
    const buffer = await ctx.decodeAudioData(data.slice(0));
    buffers.set(src, buffer);
  }

  /**
   * Prefetch and decode all SFX buffers.
   *
   * @returns {Promise<void>}
   */
  function loadAllBuffers() {
    if (loadPromise) return loadPromise;
    const ctx = getAudioContext();
    if (!ctx) {
      loadPromise = Promise.resolve();
      return loadPromise;
    }
    loadPromise = Promise.all(
      Object.values(CLIPS).map((src) => decodeClip(src, ctx).catch((err) => {
        console.warn('[sounds] decode failed:', src, err);
      }))
    ).then(() => {});
    return loadPromise;
  }

  /**
   * Play a predecoded clip through Web Audio.
   *
   * @param {string} src Clip URL.
   * @param {number} volume Linear gain 0–1.
   * @param {number} [delayMs]
   * @returns {void}
   */
  function playClip(src, volume, delayMs) {
    if (!isActive() || !src) return;

    const start = () => {
      const ctx = getAudioContext();
      const buffer = buffers.get(src);
      if (!ctx || !buffer) return;
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, volume));
      source.connect(gain);
      gain.connect(ctx.destination);
      try {
        source.start(0);
      } catch (err) {
        /* ignore start errors */
      }
    };

    if (delayMs > 0) {
      window.setTimeout(start, delayMs);
      return;
    }

    if (!buffers.has(src)) {
      loadAllBuffers().then(() => {
        if (buffers.has(src) && isActive()) start();
      });
      return;
    }
    start();
  }

  /**
   * Resume AudioContext and ensure buffers are decoded (mobile gesture unlock).
   *
   * @returns {void}
   */
  function unlock() {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    loadAllBuffers();
    unlocked = true;
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
      case 'other_turn':
        playClip(CLIPS.other_turn, otherVol);
        break;
      case 'game_end':
        playClip(opts.didWin ? CLIPS.game_end_win : CLIPS.game_end_loss, selfVol);
        break;
      case 'end_turn':
        playClip(CLIPS.end_turn, selfVol);
        break;
      case 'leave_click':
        playClip(CLIPS.leave_click, selfVol);
        break;
      case 'player_join':
        playClip(CLIPS.player_join, otherVol);
        break;
      case 'mountain_closed':
        playClip(CLIPS.mountain_closed, otherVol);
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
   * Prefetch clips and bind toggle buttons.
   *
   * @returns {void}
   */
  function init() {
    enabled = readStoredEnabled();
    getAudioContext();
    loadAllBuffers();
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
