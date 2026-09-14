const admin = require("../config/firebase");

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

    const decodedToken = await admin.auth().verifyIdToken(idToken);

    req.user = decodedToken;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
};

module.exports = authenticate;
