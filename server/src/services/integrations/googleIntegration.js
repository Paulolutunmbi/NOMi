const { getGoogleAuthForUser, refreshGoogleAccessToken } = require("./googleCredentialService");
const { createGmailProvider, SUPPORTED_ACTIONS } = require("./gmailProvider");

const createGoogleIntegration = ({ credentialService = { getGoogleAuthForUser, refreshGoogleAccessToken }, gmailProvider = createGmailProvider() } = {}) => ({
  provider: "google",
  capabilities: [...SUPPORTED_ACTIONS],
  async execute({ user, action, payload }) {
    if (!SUPPORTED_ACTIONS.has(action)) {
      const error = new Error("Unsupported Google action");
      error.code = "gmail_invalid_request";
      throw error;
    }
    let connection;
    try {
      connection = await credentialService.getGoogleAuthForUser(user._id);
      const expiresSoon = !connection.account.accessTokenExpiresAt || connection.account.accessTokenExpiresAt.getTime() <= Date.now() + 60 * 1000;
      if (expiresSoon || !connection.auth.credentials?.access_token) await credentialService.refreshGoogleAccessToken(connection.account, connection.auth);
      return await gmailProvider.execute(connection.auth, action, payload);
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
