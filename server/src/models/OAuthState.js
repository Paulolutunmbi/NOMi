const mongoose = require("mongoose");

// A one-time, short-lived record prevents OAuth callback replay without storing the state itself.
const oauthStateSchema = new mongoose.Schema(
  {
    stateHash: { type: String, required: true, unique: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OAuthState", oauthStateSchema);
