/**
 * Admin alert event type constants and sender configuration.
 */

const NEW_USER = 'NEW_USER';

/** Default Resend test sender address for new-user signup alerts. */
const NEW_USER_FROM_ADDRESS = 'onboarding@resend.dev';

/** Default game name shown in alert sender and email copy. */
const DEFAULT_ALERT_GAME_NAME = 'Mountain Goats';

/**
 * Resolve the game name used in admin alert emails.
 *
 * @returns {string}
 */
function getAlertGameName() {
  const name = String(process.env.ALERT_GAME_NAME || '').trim();
  return name || DEFAULT_ALERT_GAME_NAME;
}

/**
 * Resolve the from address for new-user signup alerts.
 * Uses Resend display-name format: "Game Name <email@domain.com>".
 *
 * @returns {string}
 */
function getNewUserFromEmail() {
  const gameName = getAlertGameName();
  const address = String(process.env.NEW_USER_FROM_EMAIL || '').trim() || NEW_USER_FROM_ADDRESS;
  return `${gameName} <${address}>`;
}

module.exports = {
  NEW_USER,
  NEW_USER_FROM_ADDRESS,
  DEFAULT_ALERT_GAME_NAME,
  getAlertGameName,
  getNewUserFromEmail,
};
