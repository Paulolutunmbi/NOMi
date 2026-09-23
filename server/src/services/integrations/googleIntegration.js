const { getGoogleAuthForUser, refreshGoogleAccessToken } = require("./googleCredentialService");
const { createGmailProvider, SUPPORTED_ACTIONS: GMAIL_ACTIONS } = require("./gmailProvider");
const { createCalendarProvider, SUPPORTED_ACTIONS: CALENDAR_ACTIONS } = require("./calendarProvider");

const createGoogleIntegration = ({
  credentialService = { getGoogleAuthForUser, refreshGoogleAccessToken },
  gmailProvider = createGmailProvider(),
  calendarProvider = createCalendarProvider(),
} = {}) => ({
  provider: "google",
  capabilities: [...GMAIL_ACTIONS, ...CALENDAR_ACTIONS],
  async execute({ user, action, payload }) {
    const isGmailAction = GMAIL_ACTIONS.has(action);
    const isCalendarAction = CALENDAR_ACTIONS.has(action);
    if (!isGmailAction && !isCalendarAction) {
      const error = new Error("Unsupported Google action");
      error.code = "gmail_invalid_request";
      throw error;
    }
    let connection;
    try {
      connection = await credentialService.getGoogleAuthForUser(user._id);
      const expiresSoon = !connection.account.accessTokenExpiresAt || connection.account.accessTokenExpiresAt.getTime() <= Date.now() + 60 * 1000;
      if (expiresSoon || !connection.auth.credentials?.access_token) await credentialService.refreshGoogleAccessToken(connection.account, connection.auth);
      return isGmailAction
        ? await gmailProvider.execute(connection.auth, action, payload)
        : await calendarProvider.execute(connection.auth, action, payload);
    } catch (error) {
      if (error.code) throw error;
      const safeError = new Error("Google connection needs to be reconnected");
      safeError.code = "google_reconnect_required";
      throw safeError;
    }
  },
});

module.exports = createGoogleIntegration();
module.exports.createGoogleIntegration = createGoogleIntegration;
