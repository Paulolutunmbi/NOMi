const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firebaseUid: { type: String, required: true, unique: true, index: true, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    displayName: { type: String, default: null, trim: true },
    photoUrl: { type: String, default: null, trim: true },
    lastAuthenticatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
