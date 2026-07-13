/**
 * Resend email transport for admin alerts.
 */

const { Resend } = require('resend');

const LOG_PREFIX = '[notifications]';

let resendClient = null;

/**
 * Returns true when Resend alert delivery is configured.
 *
 * @returns {boolean}
 */
function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Resolve the sender address for non-onboarding admin alerts.
 *
 * @returns {string|null}
 */
function getDefaultFromEmail() {
  const from = String(process.env.ALERT_FROM_EMAIL || '').trim();
  return from || null;
}

/**
 * Resolve the admin recipient for admin alerts.
 *
 * @returns {string}
 */
function getToEmail() {
  return process.env.ALERT_TO_EMAIL || 'aravinthsankar12@gmail.com';
}

/**
 * Lazily create the Resend client.
 *
 * @returns {import('resend').Resend}
 */
function getClient() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * Send an email through Resend.
 *
 * @param {object} message Email message.
 * @param {string} [message.from] Sender address (event-specific).
 * @param {string} message.subject Email subject.
 * @param {string} message.html HTML body.
 * @param {string} message.text Plain-text body.
 * @returns {Promise<void>}
 */
async function sendEmail(message) {
  if (!isConfigured()) return;

  const from = String(message.from || '').trim() || getDefaultFromEmail();
  if (!from) {
    throw new Error('No from address configured for this alert (set ALERT_FROM_EMAIL)');
  }

  const client = getClient();
  const { error } = await client.emails.send({
    from,
    to: [getToEmail()],
    subject: message.subject,
    html: message.html,
    text: message.text,
  });

  if (error) {
    throw new Error(error.message || 'Resend send failed');
  }
}

module.exports = {
  LOG_PREFIX,
  isConfigured,
  sendEmail,
};
