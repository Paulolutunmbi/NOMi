const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    displayName: { type: String, default: null, trim: true },
    photoUrl: { type: String, default: null, trim: true },
    lastAuthenticatedAt: { type: Date, default: Date.now },
    // What the user typed at sign-up (or later changed in Settings), e.g.
    // "Nigeria" or "Kenya" — kept as-is for display. timeZone is the IANA
    // zone resolved from it, used to default new calendar events.
    country: { type: String, default: null, trim: true },
    timeZone: { type: String, default: null, trim: true },
    legalAcceptance: {
      termsVersion: { type: String, default: null },
      privacyVersion: { type: String, default: null },
      acceptedAt: { type: Date, default: null },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
