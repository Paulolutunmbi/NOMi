const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDatabase = require("./config/database");
const authenticate = require("./config/auth");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    service: "NOMI API",
    message: "NOMI backend is running",
  });
});

app.get("/api/auth/me", authenticate, (req, res) => {
  res.status(200).json({
    success: true,
    user: {
      uid: req.user.uid,
      email: req.user.email || null,
      name: req.user.name || null,
      picture: req.user.picture || null,
    },
  });
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
