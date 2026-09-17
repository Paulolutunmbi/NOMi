const AuditLog = require("../../models/AuditLog");

const writeAIAudit = ({ user, action = "ai.intent", provider, conversationId, outcome, reason }) => AuditLog.create({
  user: user._id || user,
  provider: "ai",
  action,
  permissionRequired: false,
  permissionDecision: "not_required",
  outcome,
  // Never add requests, retrieved content, or placeholder mappings here.
  metadata: { provider: provider || null, conversationId, reason: reason || null },
});
module.exports = { writeAIAudit };
