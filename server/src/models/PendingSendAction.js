const mongoose = require("mongoose");

const pendingSendActionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  actionType: { type: String, enum: ["gmail.send", "gmail.send.reply"], required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ["pending", "approving", "denied", "completed", "failed", "expired"], default: "pending", index: true },
  expiresAt: { type: Date, required: true },
  approvedAt: Date,
  consumedAt: Date,
  completedAt: Date,
}, { timestamps: true });

pendingSendActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
module.exports = mongoose.model("PendingSendAction", pendingSendActionSchema);
