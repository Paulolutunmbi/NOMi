const defaultGetUser = require("../services/users/userService").findOrCreateFromFirebaseClaims;
const { version: CURRENT_LEGAL_VERSION } = require("../../../shared/legalVersion.json");

const EXEMPT_PATHS = new Set([
  "/api/auth/me",
  "/api/auth/legal-acceptance",
  "/api/auth/logout",
]);

const createLegalAcceptanceMiddleware = ({ getUser = defaultGetUser, currentVersion = CURRENT_LEGAL_VERSION } = {}) => async (req, res, next) => {
  const requestPath = (req.originalUrl || req.path).split("?")[0];
  if (EXEMPT_PATHS.has(requestPath)) return next();

  try {
    const user = await getUser(req.user);
    const acceptance = user.legalAcceptance || {};
    if (acceptance.termsVersion !== currentVersion || acceptance.privacyVersion !== currentVersion) {
      return res.status(403).json({ success: false, code: "LEGAL_ACCEPTANCE_REQUIRED" });
    }
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = { createLegalAcceptanceMiddleware };
