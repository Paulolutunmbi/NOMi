const AuditLog = require("../../models/AuditLog");
const { checkPermission } = require("../permissions/permissionService");
const { getIntegration } = require("../integrations/integrationRegistry");

const writeAudit = (entry) => AuditLog.create(entry);

const executeAction = async ({ user, provider, action, payload = {}, target, approval }) => {
  const permission = await checkPermission({ userId: user._id, provider, action });
  const permissionDecision = permission.decision || approval || null;

  if (permission.decision === "deny" || approval === "deny") {
    await writeAudit({ user: user._id, provider, action, target, permissionRequired: false, permissionDecision: "deny", outcome: "failure" });
    return { status: "denied", provider, action };
  }

  if (!permission.allowed && approval !== "allow_once") {
    await writeAudit({ user: user._id, provider, action, target, permissionRequired: true, permissionDecision: permissionDecision || "not_required", outcome: "pending_approval" });
    return { status: "approval_required", provider, action };
  }

  const integration = getIntegration(provider);
  if (!integration || !integration.capabilities?.includes(action)) {
    throw new Error(`Unsupported integration action: ${provider}.${action}`);
  }

  try {
    const result = await integration.execute({ user, action, payload });
    await writeAudit({ user: user._id, provider, action, target, permissionRequired: !permission.allowed, permissionDecision: permission.allowed ? "always_allow" : "allow_once", outcome: "success", metadata: result?.auditMetadata || {} });
    return { status: "success", result };
  } catch (error) {
    await writeAudit({ user: user._id, provider, action, target, permissionRequired: !permission.allowed, permissionDecision: permission.allowed ? "always_allow" : "allow_once", outcome: "failure", metadata: { errorCode: error.code || "execution_failed" } });
    throw error;
  }
};

module.exports = { executeAction };
