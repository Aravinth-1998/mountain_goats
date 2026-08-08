/**
 * iOS Safari haptic ticks via invisible checkbox[switch] overlays on real tap targets.
 * Programmatic label.click() is unreliable on current iOS; finger must hit the switch.
 * Adapted from aadeexyz/tactus (MIT).
 */
(function () {
  const BOUND_ATTR = 'data-mg-haptic-bound';
  let iosCached = null;
  let idSeq = 0;

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
   * Remove overlay switch from a host element.
   *
   * @param {Element|null|undefined} el Host control.
   * @returns {void}
   */
  function unbindHapticTarget(el) {
    if (!el || !el.querySelector) return;
    const sw = el.querySelector(':scope > .mg-haptic-switch');
    if (sw) sw.remove();
    el.classList.remove('mg-haptic-host');
    el.removeAttribute(BOUND_ATTR);
  }

  /**
   * Stack an invisible switch on a tap target so Safari fires a system haptic on press.
   * Forwards one host.click() after the switch activates (avoids double-firing).
   *
   * @param {Element|null|undefined} el Host button or die.
   * @returns {void}
   */
  function bindHapticTarget(el) {
    if (!el || !isIOS()) return;
    if (el.getAttribute(BOUND_ATTR) === '1' && el.querySelector(':scope > .mg-haptic-switch')) {
      return;
    }
    unbindHapticTarget(el);

    el.classList.add('mg-haptic-host');
    el.setAttribute(BOUND_ATTR, '1');

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'mg-haptic-switch';
    input.setAttribute('switch', '');
    input.setAttribute('aria-hidden', 'true');
    input.tabIndex = -1;
    input.id = 'mg-haptic-sw-' + String(++idSeq);

    let forwarding = false;

    input.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    input.addEventListener('change', () => {
      if (forwarding) return;
      forwarding = true;
      input.checked = false;
      input.style.pointerEvents = 'none';
      try {
        if (!(el instanceof HTMLButtonElement && el.disabled)) {
          el.click();
        }
      } finally {
        window.requestAnimationFrame(() => {
          input.style.pointerEvents = '';
          forwarding = false;
        });
      }
    });

    el.appendChild(input);
  }

  /**
   * Best-effort tick without an overlay (Android vibrate). No-op on iOS.
   *
   * @param {number} [duration=10] Vibrate duration in ms when not on iOS.
   * @returns {void}
   */
  function triggerHaptic(duration) {
    if (typeof window === 'undefined') return;
    if (isIOS()) return;
    const ms = typeof duration === 'number' ? duration : 10;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms);
    }
  }

  window.MGTactus = {
    isIOS,
    bindHapticTarget,
    unbindHapticTarget,
    triggerHaptic,
  };
})();
