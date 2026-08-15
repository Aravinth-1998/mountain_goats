/**
 * Cute "3…2…1…Climb!" overlay shown when a match begins (Modern UI only).
 * The matching jingle is synthesized in sounds.js (MGSounds.playCountdown).
 * Pure DOM + CSS animation, no external deps.
 */
(function () {
  /** @type {number[]} Delays (ms) for 3, 2, 1, Climb!. */
  const STEP_AT = [0, 900, 1800, 2700];
  const CLIMB_MS = 1500;
  const FADE_MS = 350;
  const CLEANUP_MS = 3200;

  let rootEl = null;
  let digitEl = null;
  let timers = [];
  let running = false;

  /**
   * @returns {boolean}
   */
  function isModern() {
    const docEl = document.documentElement;
    return !!(docEl && docEl.getAttribute('data-ui') === 'modern');
  }

  /**
   * @returns {boolean}
   */
  function isReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /**
   * Lazily create the overlay once.
   *
   * @returns {void}
   */
  function ensureEl() {
    if (rootEl) return;
    rootEl = document.createElement('div');
    rootEl.id = 'start-countdown';
    rootEl.className = 'start-countdown';
    rootEl.setAttribute('aria-hidden', 'true');
    rootEl.innerHTML = '<div class="start-countdown-stage"><span class="start-countdown-digit"></span></div>';
    document.body.appendChild(rootEl);
    digitEl = rootEl.querySelector('.start-countdown-digit');
  }

  /**
   * @returns {void}
   */
  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  /**
   * @param {string} text
   * @param {boolean} isClimb
   * @returns {void}
   */
  function setStep(text, isClimb) {
    if (!digitEl) return;
    digitEl.textContent = text;
    digitEl.classList.remove('is-pop', 'is-climb');
    void digitEl.offsetWidth; // restart the animation
    digitEl.classList.add(isClimb ? 'is-climb' : 'is-pop');
  }

  /**
   * Fade the overlay away.
   *
   * @returns {void}
   */
  function finish() {
    running = false;
    if (!rootEl) return;
    rootEl.classList.remove('is-showing');
    if (isReducedMotion()) {
      rootEl.classList.add('is-hidden');
      return;
    }
    timers.push(setTimeout(() => rootEl.classList.add('is-hidden'), FADE_MS));
  }

  /**
   * Play the countdown (no-op outside Modern UI or while already running).
   *
   * @returns {void}
   */
  function run() {
    if (running || !isModern()) return;
    ensureEl();
    clearTimers();
    running = true;
    rootEl.classList.remove('is-hidden');
    rootEl.classList.add('is-showing');
    setStep('3', false);
    timers.push(setTimeout(() => setStep('2', false), STEP_AT[1]));
    timers.push(setTimeout(() => setStep('1', false), STEP_AT[2]));
    timers.push(setTimeout(() => setStep('Climb!', true), STEP_AT[3]));
    timers.push(setTimeout(finish, STEP_AT[3] + CLIMB_MS));
    timers.push(setTimeout(() => {
      if (rootEl) rootEl.classList.add('is-hidden');
    }, STEP_AT[3] + CLIMB_MS + CLEANUP_MS));
  }

  window.MGStartCountdown = { run };
})();
