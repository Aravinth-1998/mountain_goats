/**
 * Build email content for admin alert events.
 */

const { NEW_USER, NEW_USER_FROM_EMAIL } = require('./events');

/**
 * Escape HTML special characters for email bodies.
 *
 * @param {string} value Raw string value.
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Format a nullable field for display.
 *
 * @param {string|null|undefined} value Field value.
 * @returns {string}
 */
function displayValue(value) {
  const text = String(value || '').trim();
  return text || 'n/a';
}

/**
 * Build a NEW_USER alert email.
 *
 * @param {object} payload Alert payload.
 * @param {string} payload.userId Supabase auth user id.
 * @param {string} payload.googleName Google display name.
 * @param {string|null} [payload.email] Google account email.
 * @param {string|null} [payload.gamingName] Saved gaming name, if any.
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildNewUserAlert(payload) {
  const userId = displayValue(payload.userId);
  const googleName = displayValue(payload.googleName);
  const email = displayValue(payload.email);
  const gamingName = displayValue(payload.gamingName);
  const signedUpAt = new Date().toISOString();

  const text = [
    'A new user signed up for Mountain Goats.',
    '',
    `User ID: ${userId}`,
    `Google name: ${googleName}`,
    `Email: ${email}`,
    `Gaming name: ${gamingName}`,
    `Signed up at: ${signedUpAt}`,
  ].join('\n');

  const html = [
    '<p>A new user signed up for Mountain Goats.</p>',
    '<ul>',
    `<li><strong>User ID:</strong> ${escapeHtml(userId)}</li>`,
    `<li><strong>Google name:</strong> ${escapeHtml(googleName)}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(email)}</li>`,
    `<li><strong>Gaming name:</strong> ${escapeHtml(gamingName)}</li>`,
    `<li><strong>Signed up at:</strong> ${escapeHtml(signedUpAt)}</li>`,
    '</ul>',
  ].join('');

  return {
    from: NEW_USER_FROM_EMAIL,
    subject: 'Mountain Goats: new user signed up',
    html,
    text,
  };
}

/**
 * Build email content for an alert event.
 *
 * @param {string} eventType Alert event type.
 * @param {object} payload Event-specific payload.
 * @returns {{ from?: string, subject: string, html: string, text: string }|null}
 */
function buildAlert(eventType, payload) {
  switch (eventType) {
    case NEW_USER:
      return buildNewUserAlert(payload);
    default:
      return null;
  }
}

module.exports = {
  buildAlert,
};
