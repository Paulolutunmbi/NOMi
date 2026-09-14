const AuditLog = require("../../models/AuditLog");

const writeIntegrationAudit = ({ user, action, outcome, metadata = {} }) =>
  AuditLog.create({
    user: user._id || user,
    provider: "google",
    action,
    permissionRequired: false,
    permissionDecision: "not_required",
    outcome,
    metadata,
  });

module.exports = { writeIntegrationAudit };
