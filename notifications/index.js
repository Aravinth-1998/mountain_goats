/**
 * Admin alert notifications.
 */

const { buildAlert } = require('./handlers');
const resend = require('./resend');

const LOG_PREFIX = '[notifications]';

/**
 * Send an admin alert without blocking the caller.
 *
 * @param {string} eventType Alert event type.
 * @param {object} payload Event-specific payload.
 * @returns {void}
 */
function sendAlert(eventType, payload) {
  if (!resend.isConfigured()) return;

  const message = buildAlert(eventType, payload);
  if (!message) {
    console.warn(`${LOG_PREFIX} Unknown alert type: ${eventType}`);
    return;
  }

  resend.sendEmail(message).catch((err) => {
    console.warn(`${LOG_PREFIX} Failed to send ${eventType} alert:`, err.message);
  });
}

module.exports = {
  LOG_PREFIX,
  sendAlert,
};
