const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, required: true, trim: true, lowercase: true },
    action: { type: String, required: true, trim: true },
    target: {
      type: { type: String, default: null },
      id: { type: String, default: null },
      label: { type: String, default: null },
    },
    permissionRequired: { type: Boolean, required: true },
    permissionDecision: { type: String, enum: ["always_allow", "allow_once", "deny", "not_required"], required: true },
    outcome: { type: String, enum: ["success", "failure", "pending_approval"], required: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
