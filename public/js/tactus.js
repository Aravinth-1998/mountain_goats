/**
 * iOS Safari haptic ticks via checkbox[switch] (adapted from aadeexyz/tactus, MIT).
 * Best-effort: user-gesture and OS limits may mute programmatic ticks.
 */
(function () {
  const SWITCH_ID = '___haptic-switch___';

  let inputEl = null;
  let labelEl = null;
  let iosCached = null;

  /**
   * @returns {boolean}
   */
  function isIOS() {
    if (iosCached != null) return iosCached;
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      iosCached = false;
      return iosCached;
    }
    const iOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
    iosCached = iOSDevice || iPadOS;
    return iosCached;
  }

  /**
   * Ensure the hidden switch + label exist in the document.
   *
   * @returns {void}
   */
  function ensureSwitch() {
    if (inputEl && labelEl) return;
    if (typeof document === 'undefined') return;

    inputEl = document.getElementById(SWITCH_ID);
    labelEl = document.querySelector('label[for="' + SWITCH_ID + '"]');

    if (inputEl && labelEl) return;

    inputEl = document.createElement('input');
    inputEl.type = 'checkbox';
    inputEl.id = SWITCH_ID;
    inputEl.setAttribute('switch', '');
    inputEl.style.display = 'none';
    inputEl.setAttribute('aria-hidden', 'true');
    inputEl.tabIndex = -1;
    document.body.appendChild(inputEl);

    labelEl = document.createElement('label');
    labelEl.htmlFor = SWITCH_ID;
    labelEl.style.display = 'none';
    labelEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(labelEl);
  }

  /**
   * Fire one haptic tick (iOS switch) or a short vibrate elsewhere.
   *
   * @param {number} [duration=10] Vibrate duration in ms when not on iOS.
   * @returns {void}
   */
  function triggerHaptic(duration) {
    if (typeof window === 'undefined') return;
    const ms = typeof duration === 'number' ? duration : 10;

    if (isIOS()) {
      ensureSwitch();
      if (labelEl) labelEl.click();
      return;
    }

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', ensureSwitch, { once: true });
    } else {
      ensureSwitch();
    }
  }

  window.MGTactus = {
    triggerHaptic,
    isIOS,
  };
})();
