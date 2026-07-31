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
  if (!resend.isConfigured()) {
    console.warn(`${LOG_PREFIX} Skipping ${eventType} alert: RESEND_API_KEY not set in env.`);
    return;
  }

  const message = buildAlert(eventType, payload);
  if (!message) {
    console.warn(`${LOG_PREFIX} Unknown alert type: ${eventType}`);
    return;
  }

  resend.sendEmail(message)
    .then(() => console.log(`${LOG_PREFIX} Sent ${eventType} alert.`))
    .catch((err) => {
      console.warn(`${LOG_PREFIX} Failed to send ${eventType} alert:`, err.message);
    });
}

module.exports = {
  LOG_PREFIX,
  sendAlert,
};
