const mongoose = require("mongoose");

const chatSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["gmail", "calendar", "home"], required: true },
  title: { type: String, default: null, maxlength: 200 },
  summary: { type: String, default: "", maxlength: 6000 },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  connectedGoogleAccountId: { type: mongoose.Schema.Types.ObjectId, default: null },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

chatSessionSchema.index({ user: 1, type: 1, lastMessageAt: -1 });
module.exports = mongoose.model("ChatSession", chatSessionSchema);
