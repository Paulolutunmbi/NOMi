const express = require("express");
const defaultAdmin = require("../config/firebase");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const ConnectedAccount = require("../models/ConnectedAccount");
const { defaultTimeZoneForCountry } = require("../services/calendar/timeZoneResolver");

// The fallback for anyone who has not set a country yet, so a calendar event
// still lands somewhere sane instead of drifting to the server's UTC clock.
const DEFAULT_TIME_ZONE = "Africa/Lagos";

const EMAIL_REGEX = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

const createAuthRouter = ({
  firebaseAdmin = defaultAdmin,
  authMiddleware,
  getUser = findOrCreateFromFirebaseClaims,
  connectedAccountModel = ConnectedAccount,
} = {}) => {
  const router = express.Router();
  const requireAuth = authMiddleware || require("../middleware/auth");

  /**
   * GET /api/auth/me
   * Returns current authenticated NOMI user profile and connected account summary.
   */
  router.get("/me", requireAuth, async (req, res, next) => {
    try {
      const user = await getUser(req.user);
      const connectedAccounts = await connectedAccountModel.find({
        user: user._id,
        status: { $in: ["connected", "active"] },
      }).select("provider providerAccountId email displayName isPrimary status").lean();

      return res.status(200).json({
        success: true,
        user: {
          id: user._id,
          uid: user.firebaseUid,
          email: user.email || req.user.email || null,
          displayName: user.displayName || req.user.name || null,
          photoUrl: user.photoUrl || req.user.picture || null,
          country: user.country || null,
          timeZone: user.timeZone || DEFAULT_TIME_ZONE,
        },
        connectedAccounts: connectedAccounts.map((acc) => ({
          id: acc._id,
          provider: acc.provider,
          email: acc.email,
          displayName: acc.displayName,
          isPrimary: Boolean(acc.isPrimary),
          status: acc.status,
        })),
        connectedAccountsCount: connectedAccounts.length,
      });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/country/check
   * Public (used on the sign-up form before an account exists): says
   * whether NOMI can turn what was typed into a time zone, so a typo is
   * caught up front instead of silently falling back to a default zone.
   */
  router.post("/country/check", (req, res) => {
    const { country } = req.body || {};
    const trimmed = typeof country === "string" ? country.trim().slice(0, 80) : "";
    const timeZone = trimmed ? defaultTimeZoneForCountry(trimmed) : null;
    if (!timeZone) {
      return res.status(400).json({ success: false, error: { code: "COUNTRY_NOT_RECOGNIZED", message: "NOMI doesn't recognize that country. Try the full country name." } });
    }
    return res.status(200).json({ success: true, timeZone });
  });

  /**
   * PATCH /api/auth/me/country
   * Sets or changes the country used to default this user's calendar
   * events (and, going forward, their mail time zone). Available from
   * Settings at any time, not just at sign-up.
   */
  router.patch("/me/country", requireAuth, async (req, res, next) => {
    const { country } = req.body || {};
    const trimmed = typeof country === "string" ? country.trim().slice(0, 80) : "";
    if (!trimmed) {
      return res.status(400).json({ success: false, error: { code: "COUNTRY_REQUIRED", message: "Enter a country." } });
    }
    const timeZone = defaultTimeZoneForCountry(trimmed);
    if (!timeZone) {
      return res.status(400).json({ success: false, error: { code: "COUNTRY_NOT_RECOGNIZED", message: "NOMI doesn't recognize that country. Try the full country name." } });
    }
    try {
      const user = await getUser(req.user);
      user.country = trimmed;
      user.timeZone = timeZone;
      await user.save();
      return res.status(200).json({ success: true, user: { country: user.country, timeZone: user.timeZone } });
    } catch (error) {
      next(error);
    }
  });

  /**
   * POST /api/auth/register
   * Creates an independent NOMI account with email and password.
   */
  router.post("/register", async (req, res, next) => {
    const { email, password, displayName, country } = req.body || {};

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_EMAIL", message: "A valid email address is required" },
      });
    }

    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: "WEAK_PASSWORD", message: "Password must be at least 6 characters" },
      });
    }

    try {
      const trimmedEmail = email.trim().toLowerCase();
      const trimmedName = typeof displayName === "string" ? displayName.trim().slice(0, 100) : null;
      const trimmedCountry = typeof country === "string" ? country.trim().slice(0, 80) : "";
      const resolvedTimeZone = trimmedCountry ? defaultTimeZoneForCountry(trimmedCountry) : null;

      const firebaseRecord = await firebaseAdmin.auth().createUser({
        email: trimmedEmail,
        password,
        displayName: trimmedName || undefined,
      });

      const user = await getUser({
        uid: firebaseRecord.uid,
        email: firebaseRecord.email,
        name: firebaseRecord.displayName,
      });

      if (trimmedCountry) {
        user.country = trimmedCountry;
        user.timeZone = resolvedTimeZone || DEFAULT_TIME_ZONE;
        await user.save();
      }

      return res.status(201).json({
        success: true,
        user: {
          id: user._id,
          uid: user.firebaseUid,
          email: user.email,
          displayName: user.displayName,
          country: user.country || null,
          timeZone: user.timeZone || DEFAULT_TIME_ZONE,
        },
        message: "NOMI account created successfully",
      });
    } catch (error) {
      if (error.code === "auth/email-already-exists") {
        return res.status(409).json({
          success: false,
          error: { code: "EMAIL_EXISTS", message: "An account with this email already exists" },
        });
      }
      if (error.code === "auth/invalid-password") {
        return res.status(400).json({
          success: false,
          error: { code: "INVALID_PASSWORD", message: error.message },
        });
      }
      next(error);
    }
  });

  /**
   * POST /api/auth/session
   * Validates session / token and provisions or refreshes the NOMI user.
   */
  router.post("/session", async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const tokenFromHeader = /^Bearer (\S+)$/.exec(authHeader || "")?.[1];
    const idToken = tokenFromHeader || req.body?.idToken;

    if (!idToken || typeof idToken !== "string") {
      return res.status(401).json({
        success: false,
        error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication token is required" },
      });
    }

    try {
      const decodedToken = await firebaseAdmin.auth().verifyIdToken(idToken);
      const user = await getUser(decodedToken);

      const connectedAccounts = await connectedAccountModel.find({
        user: user._id,
        status: { $in: ["connected", "active"] },
      }).lean();

      return res.status(200).json({
        success: true,
        user: {
          id: user._id,
          uid: user.firebaseUid,
          email: user.email,
          displayName: user.displayName,
          country: user.country || null,
          timeZone: user.timeZone || DEFAULT_TIME_ZONE,
        },
        hasConnectedGoogle: connectedAccounts.some((a) => a.provider === "google"),
      });
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: { code: "INVALID_TOKEN", message: "Invalid or expired authentication token" },
      });
    }
  });

  /**
   * POST /api/auth/logout
   * Revokes refresh tokens for the authenticated NOMI session.
   */
  router.post("/logout", requireAuth, async (req, res, next) => {
    try {
      if (req.user?.uid) {
        await firebaseAdmin.auth().revokeRefreshTokens(req.user.uid).catch(() => {});
      }
      return res.status(200).json({
        success: true,
        message: "Successfully signed out of NOMI",
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};

module.exports = { createAuthRouter };
