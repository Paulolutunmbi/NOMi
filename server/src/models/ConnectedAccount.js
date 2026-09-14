const mongoose = require("mongoose");

const connectedAccountSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, required: true, trim: true, lowercase: true },
    providerAccountId: { type: String, required: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    displayName: { type: String, default: null, trim: true },
    grantedScopes: { type: [String], default: [] },
    status: { type: String, enum: ["active", "connected", "revoked", "error"], default: "connected" },
    encryptedRefreshToken: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    encryptedAccessToken: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    accessTokenExpiresAt: { type: Date, default: null, select: false },
    lastSyncedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

connectedAccountSchema.index({ user: 1, provider: 1, providerAccountId: 1 }, { unique: true });

connectedAccountSchema.set("toJSON", {
  transform: (_document, returned) => {
    delete returned.encryptedRefreshToken;
    delete returned.encryptedAccessToken;
    delete returned.accessTokenExpiresAt;
    return returned;
  },
});

module.exports = mongoose.model("ConnectedAccount", connectedAccountSchema);
