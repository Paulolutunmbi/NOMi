const { google } = require("googleapis");
const ConnectedAccount = require("../../models/ConnectedAccount");
const { GOOGLE_SCOPES, getGoogleOAuthConfig } = require("../../config/googleOAuth");
const { encrypt, decrypt } = require("../security/tokenEncryptionService");

const createOAuthClient = () => {
  const config = getGoogleOAuthConfig();
  return new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri);
};

const getAuthorizationUrl = (state) => createOAuthClient().generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  include_granted_scopes: true,
  scope: GOOGLE_SCOPES,
  state,
});

const exchangeCodeAndIdentifyAccount = async (code) => {
  const auth = createOAuthClient();
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) {
    const error = new Error("Google did not return a refresh token");
    error.code = "google_refresh_token_missing";
    throw error;
  }
  auth.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth });
  const { data } = await oauth2.userinfo.get();
  if (!data.id || !data.email) {
    const error = new Error("Google account identification failed");
    error.code = "google_account_identification_failed";
    throw error;
  }
  return { tokens, profile: { id: data.id, email: data.email, displayName: data.name || null } };
};

const storeGoogleConnection = async ({ user, tokens, profile }) => {
  const grantedScopes = String(tokens.scope || GOOGLE_SCOPES.join(" ")).split(/\s+/).filter(Boolean);
  const values = {
    email: profile.email,
    displayName: profile.displayName,
    grantedScopes,
    status: "connected",
    encryptedRefreshToken: encrypt(tokens.refresh_token),
    encryptedAccessToken: tokens.access_token ? encrypt(tokens.access_token) : null,
    accessTokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
  return ConnectedAccount.findOneAndUpdate(
    { user: user._id, provider: "google", providerAccountId: profile.id },
    { $set: values, $setOnInsert: { user: user._id, provider: "google", providerAccountId: profile.id } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

const getGoogleAuthForUser = async (userId) => {
  const account = await ConnectedAccount.findOne({ user: userId, provider: "google" })
    .select("+encryptedRefreshToken +encryptedAccessToken +accessTokenExpiresAt");
  if (!account) {
    const error = new Error("Google account is not connected");
    error.code = "google_not_connected";
    throw error;
  }
  if (["revoked", "error"].includes(account.status) || !account.encryptedRefreshToken) {
    const error = new Error("Google connection needs to be reconnected");
    error.code = "google_reconnect_required";
    throw error;
  }
  const auth = createOAuthClient();
  auth.setCredentials({
    refresh_token: decrypt(account.encryptedRefreshToken),
    access_token: account.encryptedAccessToken ? decrypt(account.encryptedAccessToken) : undefined,
    expiry_date: account.accessTokenExpiresAt?.getTime(),
  });
  return { auth, account };
};

const refreshGoogleAccessToken = async (account, auth) => {
  try {
    const { credentials } = await auth.refreshAccessToken();
    if (!credentials.access_token) throw new Error("No access token returned during refresh");
    account.encryptedAccessToken = encrypt(credentials.access_token);
    account.accessTokenExpiresAt = credentials.expiry_date ? new Date(credentials.expiry_date) : null;
    if (credentials.refresh_token) account.encryptedRefreshToken = encrypt(credentials.refresh_token);
    await account.save();
    auth.setCredentials({ ...auth.credentials, ...credentials });
    return credentials.access_token;
  } catch (error) {
    account.status = "error";
    await account.save();
    const safeError = new Error("Google connection needs to be reconnected");
    safeError.code = "google_reconnect_required";
    throw safeError;
  }
};

const getValidGoogleAccessToken = async (userId) => {
  const { auth, account } = await getGoogleAuthForUser(userId);
  const expiresSoon = !account.accessTokenExpiresAt || account.accessTokenExpiresAt.getTime() <= Date.now() + 60 * 1000;
  if (expiresSoon || !auth.credentials.access_token) return refreshGoogleAccessToken(account, auth);
  return auth.credentials.access_token;
};

const revokeGoogleRefreshToken = async (refreshToken) => createOAuthClient().revokeToken(refreshToken);

module.exports = {
  GOOGLE_SCOPES,
  getAuthorizationUrl,
  exchangeCodeAndIdentifyAccount,
  storeGoogleConnection,
  getGoogleAuthForUser,
  getValidGoogleAccessToken,
  refreshGoogleAccessToken,
  revokeGoogleRefreshToken,
};
