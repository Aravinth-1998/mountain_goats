/**
 * Payload validation helpers for socket event handlers.
 *
 * Every socket handler destructures a payload it received from an untrusted
 * client. A malicious or buggy client can send `null`, `undefined`, a string,
 * or an object shaped nothing like the handler expects — and destructuring
 * `null` or `undefined` throws a TypeError that would kill an in-flight turn
 * for every other player in the room. These helpers normalize inputs so
 * handlers can focus on game logic instead of defensive plumbing.
 */

/**
 * Normalize any socket payload into a plain object. A client that emits a
 * primitive (`socket.emit('adjustDie', 42)`) or `null` would otherwise crash
 * the handler on destructuring.
 *
 * @param {*} payload Raw payload value from a socket event.
 * @returns {object} An object safe to destructure.
 */
function safePayload(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  return {};
}

/**
 * Coerce a value to a safe integer or return null. Rejects NaN, Infinity, and
 * non-integer floats. Optional `min`/`max` bound the accepted range.
 *
 * @param {*} value Raw value from a socket payload.
 * @param {object} [opts]
 * @param {number} [opts.min] Inclusive lower bound.
 * @param {number} [opts.max] Inclusive upper bound.
 * @returns {number|null}
 */
function toInt(value, opts = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

/**
 * Return `value` if it is a non-empty string within `maxLength`, otherwise null.
 *
 * @param {*} value Raw value from a socket payload.
 * @param {object} [opts]
 * @param {number} [opts.maxLength] Inclusive character cap (default 200).
 * @returns {string|null}
 */
function toBoundedString(value, opts = {}) {
  if (typeof value !== 'string') return null;
  const max = opts.maxLength ?? 200;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/**
 * Coerce a value to boolean. Loosely matches truthy client conventions
 * ("true"/"false" strings, 0/1 numbers, undefined-as-false).
 *
 * @param {*} value Raw value from a socket payload.
 * @returns {boolean}
 */
function toBool(value) {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  return Boolean(value);
}

/**
 * True when `value` is a distinct-element array of integers each within `[min, max]`
 * and the array length is between `minLength` and `maxLength`.
 *
 * Callers still need to enforce game-specific constraints (e.g. "not already
 * used") — this only ensures the shape is safe to iterate over.
 *
 * @param {*} value Raw value from a socket payload.
 * @param {object} opts
 * @param {number} opts.min Inclusive lower bound for elements.
 * @param {number} opts.max Inclusive upper bound for elements.
 * @param {number} [opts.minLength] Inclusive lower bound for array length (default 0).
 * @param {number} opts.maxLength Inclusive upper bound for array length.
 * @returns {boolean}
 */
function isDistinctIntArray(value, opts) {
  if (!Array.isArray(value)) return false;
  const minLength = opts.minLength ?? 0;
  if (value.length < minLength || value.length > opts.maxLength) return false;
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'number' || !Number.isInteger(item)) return false;
    if (item < opts.min || item > opts.max) return false;
    if (seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

/**
 * Wrap a socket-event listener so a thrown error is logged instead of escaping
 * to the process. Socket.IO's default behavior would surface synchronous throws
 * as `uncaughtException` — with the process-level safety net that no longer
 * crashes the server, but the client that triggered the event still hangs
 * because its ack callback never fires. Wrapping here means we can invoke the
 * ack with an error and keep every other client oblivious to the failure.
 *
 * @param {string} event Event name (for logs).
 * @param {(payload: object, cb?: Function) => any} handler The event handler.
 * @returns {(rawPayload?: unknown, cb?: unknown) => void}
 */
function safeHandler(event, handler) {
  return function wrapped(rawPayload, cb) {
    const payload = safePayload(rawPayload);
    const ack = typeof cb === 'function' ? cb : null;
    try {
      const result = handler(payload, ack);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          console.error(`[socket] ${event} async handler failed:`, err && err.stack ? err.stack : err);
          if (ack) {
            try { ack({ error: 'Server error, please try again.' }); }
            catch (_) { /* client is gone */ }
          }
        });
      }
    } catch (err) {
      console.error(`[socket] ${event} handler threw:`, err && err.stack ? err.stack : err);
      if (ack) {
        try { ack({ error: 'Server error, please try again.' }); }
        catch (_) { /* client is gone */ }
      }
    }
  };
}

module.exports = {
  safePayload,
  toInt,
  toBoundedString,
  toBool,
  isDistinctIntArray,
  safeHandler,
};
