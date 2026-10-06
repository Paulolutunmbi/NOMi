const admin = require("../config/firebase");
const { createLegalAcceptanceMiddleware } = require("../middleware/legalAcceptance");
const requireLegalAcceptance = createLegalAcceptanceMiddleware();

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    const bearerToken = /^Bearer (\S+)$/.exec(authHeader || "");

    if (!bearerToken) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const idToken = bearerToken[1];
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ success: false, message: "Invalid or expired authentication token" });
    }

    req.user = decodedToken;
    return requireLegalAcceptance(req, res, next);
  } catch (error) { next(error); }
};

module.exports = authenticate;
