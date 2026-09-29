const GOOGLE_SCOPES = Object.freeze([
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  // Needed to mark messages as read (removing the UNREAD label).
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar",
]);

const getGoogleOAuthConfig = () => {
  const required = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_OAUTH_STATE_SECRET",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
    "GOOGLE_OAUTH_SUCCESS_REDIRECT_URI",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error("Google OAuth is not configured");
    error.code = "google_oauth_not_configured";
    throw error;
  }

  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_OAUTH_REDIRECT_URI,
    stateSecret: process.env.GOOGLE_OAUTH_STATE_SECRET,
    tokenEncryptionKey: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    successRedirectUri: process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT_URI,
  };
};

module.exports = { GOOGLE_SCOPES, getGoogleOAuthConfig };
