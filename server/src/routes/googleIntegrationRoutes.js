const express = require("express");
const authenticate = require("../middleware/auth");
const ConnectedAccount = require("../models/ConnectedAccount");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { createOAuthState, consumeOAuthState } = require("../services/integrations/googleStateService");
const { getAuthorizationUrl, exchangeCodeAndIdentifyAccount, storeGoogleConnection, revokeGoogleRefreshToken } = require("../services/integrations/googleCredentialService");
const { getGoogleOAuthConfig } = require("../config/googleOAuth");
const { decrypt } = require("../services/security/tokenEncryptionService");
const { writeIntegrationAudit } = require("../services/audit/auditService");

const router = express.Router();
const safeRedirect = (result) => {
  try {
    const redirect = new URL(getGoogleOAuthConfig().successRedirectUri);
    redirect.searchParams.set("google", result);
    return redirect.toString();
  } catch { return null; }
};
const callbackFailure = (res, status = 400) => {
  const redirect = safeRedirect("failed");
  return redirect ? res.redirect(302, redirect) : res.status(status).send("Google connection could not be completed.");
};

router.get("/connect", authenticate, async (req, res, next) => {
  try {
    const user = await findOrCreateFromFirebaseClaims(req.user);
    const state = await createOAuthState(user);
    const authorizationUrl = getAuthorizationUrl(state);
    await writeIntegrationAudit({ user, action: "google.connect.started", outcome: "success" });
    if (req.query.mode === "json") return res.status(200).json({ success: true, authorizationUrl });
    return res.redirect(302, authorizationUrl);
  } catch (error) {
    if (error.code === "google_oauth_not_configured") return res.status(503).json({ success: false, message: "Google connection is not configured" });
    next(error);
  }
});

router.get("/callback", async (req, res) => {
  let user;
  try {
    const userId = await consumeOAuthState(req.query.state);
    user = { _id: userId };
    if (req.query.error || !req.query.code) {
      const denial = new Error("Google consent was not completed");
      denial.code = "google_consent_not_completed";
      throw denial;
    }
    const { tokens, profile } = await exchangeCodeAndIdentifyAccount(req.query.code);
    await storeGoogleConnection({ user, tokens, profile });
    await writeIntegrationAudit({ user, action: "google.connect.completed", outcome: "success", metadata: { accountEmail: profile.email } });
    return res.redirect(302, safeRedirect("connected"));
  } catch (error) {
    if (user) await writeIntegrationAudit({ user, action: "google.connect.failed", outcome: "failure", metadata: { errorCode: error.code || "oauth_callback_failed" } }).catch(() => {});
    return callbackFailure(res);
  }
});

router.get("/status", authenticate, async (req, res, next) => {
  try {
    const user = await findOrCreateFromFirebaseClaims(req.user);
    const account = await ConnectedAccount.findOne({ user: user._id, provider: "google", status: { $in: ["connected", "active"] } }).lean();
    if (!account) return res.status(200).json({ success: true, connected: false });
    return res.status(200).json({ success: true, connected: true, account: { email: account.email, displayName: account.displayName, provider: "google", status: "connected", scopes: account.grantedScopes } });
  } catch (error) { next(error); }
});

router.delete("/", authenticate, async (req, res, next) => {
  try {
    const user = await findOrCreateFromFirebaseClaims(req.user);
    const account = await ConnectedAccount.findOne({ user: user._id, provider: "google", status: { $in: ["connected", "active", "error"] } }).select("+encryptedRefreshToken");
    if (!account) return res.status(200).json({ success: true, connected: false });
    let revocation = "not_attempted";
    if (account.encryptedRefreshToken) {
      try { await revokeGoogleRefreshToken(decrypt(account.encryptedRefreshToken)); revocation = "confirmed"; } catch { revocation = "not_confirmed"; }
    }
    account.status = "revoked";
    account.encryptedRefreshToken = null;
    account.encryptedAccessToken = null;
    account.accessTokenExpiresAt = null;
    await account.save();
    await writeIntegrationAudit({ user, action: "google.disconnect.completed", outcome: "success", metadata: { revocation } });
    return res.status(200).json({ success: true, connected: false });
  } catch (error) {
    try { const user = await findOrCreateFromFirebaseClaims(req.user); await writeIntegrationAudit({ user, action: "google.disconnect.failed", outcome: "failure", metadata: { errorCode: error.code || "disconnect_failed" } }); } catch {}
    next(error);
  }
});

module.exports = router;
