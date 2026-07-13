/**
 * Build email content for admin alert events.
 */

const { NEW_USER, getAlertGameName, getNewUserFromEmail } = require('./events');

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
 * Format a community member line for new-user alerts.
 *
 * @param {number|null|undefined} memberNumber Community member number.
 * @returns {string|null}
 */
function formatCommunityMemberLine(memberNumber) {
  const count = Number(memberNumber);
  if (!Number.isFinite(count) || count < 1) return null;
  const gameName = getAlertGameName();
  const suffix = count === 1 ? 'st' : count === 2 ? 'nd' : count === 3 ? 'rd' : 'th';
  return `They are the ${count}${suffix} person to join the ${gameName} community.`;
}

/**
 * Build a NEW_USER alert email.
 *
 * @param {object} payload Alert payload.
 * @param {string} payload.userId Supabase auth user id.
 * @param {string} payload.googleName Google display name.
 * @param {string|null} [payload.email] Google account email.
 * @param {string|null} [payload.gamingName] Saved gaming name, if any.
 * @param {number|null} [payload.memberNumber] Community member number.
 * @returns {{ subject: string, html: string, text: string }}
 */
function buildNewUserAlert(payload) {
  const gameName = getAlertGameName();
  const userId = displayValue(payload.userId);
  const googleName = displayValue(payload.googleName);
  const email = displayValue(payload.email);
  const gamingName = displayValue(payload.gamingName);
  const signedUpAt = new Date().toISOString();
  const communityLine = formatCommunityMemberLine(payload.memberNumber);

  const textLines = [
    `A new user signed up for ${gameName}.`,
    '',
  ];
  if (communityLine) {
    textLines.push(communityLine, '');
  }
  textLines.push(
    `User ID: ${userId}`,
    `Google name: ${googleName}`,
    `Email: ${email}`,
    `Gaming name: ${gamingName}`,
    `Signed up at: ${signedUpAt}`,
  );

  const htmlParts = [
    `<p>A new user signed up for ${escapeHtml(gameName)}.</p>`,
  ];
  if (communityLine) {
    htmlParts.push(`<p><strong>${escapeHtml(communityLine)}</strong></p>`);
  }
  htmlParts.push(
    '<ul>',
    `<li><strong>User ID:</strong> ${escapeHtml(userId)}</li>`,
    `<li><strong>Google name:</strong> ${escapeHtml(googleName)}</li>`,
    `<li><strong>Email:</strong> ${escapeHtml(email)}</li>`,
    `<li><strong>Gaming name:</strong> ${escapeHtml(gamingName)}</li>`,
    `<li><strong>Signed up at:</strong> ${escapeHtml(signedUpAt)}</li>`,
    '</ul>',
  );

  return {
    from: getNewUserFromEmail(),
    subject: `${gameName}: new user signed up`,
    html: htmlParts.join(''),
    text: textLines.join('\n'),
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
