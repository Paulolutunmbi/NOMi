const AuditLog = require("../../models/AuditLog");
const { checkPermission } = require("../permissions/permissionService");
const { getIntegration } = require("../integrations/integrationRegistry");

const writeAudit = (entry) => AuditLog.create(entry);
const UNSAFE_AUDIT_KEY = /token|credential|secret|authorization|api.?key|password|body|content|snippet|raw|html|text/i;
const sanitizeAuditMetadata = (value, depth = 0) => {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeAuditMetadata(item, depth + 1));
  if (typeof value !== "object") return null;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !UNSAFE_AUDIT_KEY.test(key))
    .map(([key, item]) => [key, sanitizeAuditMetadata(item, depth + 1)]));
};

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
    await writeAudit({ user: user._id, provider, action, target, permissionRequired: !permission.allowed, permissionDecision: permission.allowed ? "always_allow" : "allow_once", outcome: "success", metadata: sanitizeAuditMetadata(result?.auditMetadata || {}) });
    return { status: "success", result };
  } catch (error) {
    await writeAudit({ user: user._id, provider, action, target, permissionRequired: !permission.allowed, permissionDecision: permission.allowed ? "always_allow" : "allow_once", outcome: "failure", metadata: { errorCode: error.code || "execution_failed" } });
    throw error;
  }
};

module.exports = { executeAction, sanitizeAuditMetadata };
