const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDatabase = require("./config/database");
const authenticate = require("./config/auth");
const { findOrCreateFromFirebaseClaims } = require("./services/users/userService");
const { registerIntegration } = require("./services/integrations/integrationRegistry");
const googleIntegration = require("./services/integrations/googleIntegration");
const googleIntegrationRoutes = require("./routes/googleIntegrationRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/integrations/google", googleIntegrationRoutes);

// Providers self-describe their capabilities so action orchestration stays provider-agnostic.
registerIntegration(googleIntegration);

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "NOMI API",
    message: "NOMI backend is running",
  });
});

app.get("/api/auth/me", authenticate, async (req, res, next) => {
  try {
    await findOrCreateFromFirebaseClaims(req.user);
  res.status(200).json({
    success: true,
    user: {
      uid: req.user.uid,
      email: req.user.email || null,
      name: req.user.name || null,
      picture: req.user.picture || null,
    },
  });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error("Unhandled API error:", error.message);
  res.status(500).json({ success: false, message: "Internal server error" });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDatabase();

    app.listen(PORT, () => {
      console.log(`NOMI API running on port ${PORT}`);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  }
};

startServer();
