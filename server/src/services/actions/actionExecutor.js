const AuditLog = require("../../models/AuditLog");
const { checkPermission, savePersistentDecision } = require("../permissions/permissionService");
const { getIntegration } = require("../integrations/integrationRegistry");
const PendingSendAction = require("../../models/PendingSendAction");

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

const createActionExecutor = ({ check = checkPermission, save = savePersistentDecision, getProvider = getIntegration, audit = writeAudit, pendingSendModel = PendingSendAction, now = () => new Date() } = {}) => async ({ user, provider, action, payload = {}, target, approval, conversationId }) => {
  const permission = await check({ userId: user._id, provider, action });
  const oneTimeGmailSend = provider === "google" && ["gmail.send", "gmail.send.reply"].includes(action);
  const permissionDecision = permission.decision || approval || null;

  if (permission.decision === "deny" || approval === "deny") {
    await audit({ user: user._id, provider, action, target, permissionRequired: false, permissionDecision: "deny", outcome: "failure" });
    return { status: "denied", provider, action };
  }

  // Sending is never performed by the proposal endpoint, even when a
  // persistent capability grant exists. It only creates an immutable approval.
  if (oneTimeGmailSend) {
    const recipient = String(payload.recipient || "").trim().toLowerCase();
    if (action === "gmail.send" && (!recipient || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(recipient))) return { status: "rejected", reason: "invalid_recipient" };
    // Attachment binary data is stored in a Mongo Mixed field while the send
    // awaits approval. A raw Buffer there round-trips through the driver as
    // a BSON Binary wrapper rather than a plain Buffer, which silently
    // corrupted attachments on approval. Base64-encoding here guarantees a
    // lossless round trip regardless of driver/BSON behavior; gmailProvider
    // already knows how to send a base64 string attachment.
    const boundAttachments = Array.isArray(payload.attachments)
      ? payload.attachments.map((att) => ({ ...att, data: Buffer.isBuffer(att.data) ? att.data.toString("base64") : att.data }))
      : payload.attachments;
    const boundPayload = { ...payload, recipient, ...(boundAttachments ? { attachments: boundAttachments } : {}) };
    const actionRecord = await pendingSendModel.create({ user: user._id, conversationId: conversationId || "", actionType: action, payload: boundPayload, status: "pending", expiresAt: new Date(now().getTime() + 10 * 60 * 1000) });
    return { status: "approval_required", provider, action, pendingAction: {
      id: String(actionRecord._id), action, recipient: recipient || "Existing Gmail conversation",
      subject: typeof boundPayload.subject === "string" ? boundPayload.subject : "",
      body: String(boundPayload.body || ""),
      preview: String(boundPayload.body || "").slice(0, 500), expiresAt: actionRecord.expiresAt,
      attachmentsMeta: Array.isArray(boundAttachments)
        ? boundAttachments.map((att) => ({ filename: att.filename, mimeType: att.mimeType, size: att.size }))
        : [],
    } };
  }

  if ((!permission.allowed || oneTimeGmailSend) && !["allow_once", "always_allow"].includes(approval)) {
    await audit({ user: user._id, provider, action, target, permissionRequired: true, permissionDecision: permissionDecision || "not_required", outcome: "pending_approval" });
    return { status: "approval_required", provider, action };
  }

  const integration = getProvider(provider);
  if (!integration || !integration.capabilities?.includes(action)) {
    throw new Error(`Unsupported integration action: ${provider}.${action}`);
  }

  // The stored key is the exact provider/action pair. There is intentionally
  // no provider-wide Gmail grant or action-prefix matching here.
  if (!oneTimeGmailSend && !permission.allowed && approval === "always_allow") {
    await save({ userId: user._id, provider, action, decision: "always_allow" });
  }

  try {
    if (oneTimeGmailSend && approval !== "allow_once") return { status: "approval_required", provider, action };
    const result = await integration.execute({ user, action, payload });
    await audit({ user: user._id, provider, action, target, permissionRequired: !permission.allowed, permissionDecision: permission.allowed || approval === "always_allow" ? "always_allow" : "allow_once", outcome: "success", metadata: sanitizeAuditMetadata(result?.auditMetadata || {}) });
    return { status: "success", result };
  } catch (error) {
    await audit({ user: user._id, provider, action, target, permissionRequired: !permission.allowed, permissionDecision: permission.allowed || approval === "always_allow" ? "always_allow" : "allow_once", outcome: "failure", metadata: { errorCode: error.code || "execution_failed" } });
    throw error;
  }
};

const approvePendingSend = async ({ userId, conversationId, actionId, decision, pendingSendModel = PendingSendAction, getProvider = getIntegration, audit = writeAudit, now = () => new Date() }) => {
  if (!/^[a-f0-9]{24}$/i.test(String(actionId || "")) || !["allow", "deny"].includes(decision)) return { status: "invalid" };
  const record = await pendingSendModel.findOne({ _id: actionId, user: userId, ...(conversationId ? { conversationId } : {}) }).lean();
  if (!record) return { status: "not_found" };
  if (record.actionType !== "gmail.send" && record.actionType !== "gmail.send.reply") return { status: "invalid" };
  if (record.status !== "pending") return { status: record.status === "completed" ? "already_completed" : record.status === "denied" ? "already_denied" : "already_approved" };
  if (new Date(record.expiresAt) <= now()) {
    await pendingSendModel.updateOne({ _id: record._id, user: userId, status: "pending" }, { $set: { status: "expired" } });
    return { status: "expired" };
  }
  if (decision === "deny") {
    const denied = await pendingSendModel.findOneAndUpdate({ _id: record._id, user: userId, ...(conversationId ? { conversationId } : {}), status: "pending", expiresAt: { $gt: now() } }, { $set: { status: "denied" } }, { returnDocument: "after" });
    return denied ? { status: "denied", action: record.actionType } : { status: "already_approved" };
  }
  // Atomic claim prevents parallel or replayed approvals from sending twice.
  const claimed = await pendingSendModel.findOneAndUpdate({ _id: record._id, user: userId, ...(conversationId ? { conversationId } : {}), status: "pending", expiresAt: { $gt: now() } }, { $set: { status: "approving", approvedAt: now(), consumedAt: now() } }, { returnDocument: "after" }).lean();
  if (!claimed) return { status: "already_approved" };
  const provider = getProvider("google");
  try {
    if (!provider?.capabilities?.includes(claimed.actionType)) throw new Error("Unsupported Gmail send");
    const result = await provider.execute({ user: { _id: userId }, action: claimed.actionType, payload: claimed.payload });
    await pendingSendModel.updateOne({ _id: claimed._id, status: "approving" }, { $set: { status: "completed", completedAt: now() } });
    await audit({ user: userId, provider: "google", action: claimed.actionType, permissionRequired: true, permissionDecision: "allow_once", outcome: "success" });
    return { status: "success", action: claimed.actionType, result };
  } catch (error) {
    await pendingSendModel.updateOne({ _id: claimed._id, status: "approving" }, { $set: { status: "failed" } });
    await audit({ user: userId, provider: "google", action: claimed.actionType, permissionRequired: true, permissionDecision: "allow_once", outcome: "failure", metadata: { errorCode: error.code || "execution_failed" } });
    throw error;
  }
};

const editPendingSend = async ({ userId, conversationId, actionId, recipient, subject, body, pendingSendModel = PendingSendAction, now = () => new Date() }) => {
  if (!/^[a-f0-9]{24}$/i.test(String(actionId || ""))) return { status: "invalid" };
  if (typeof recipient !== "string" || !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(recipient.trim())
    || typeof subject !== "string" || subject.length > 500 || typeof body !== "string" || !body.trim() || body.length > 10000) return { status: "invalid" };
  const updated = await pendingSendModel.findOneAndUpdate({ _id: actionId, user: userId, conversationId, status: "pending", expiresAt: { $gt: now() } }, { $set: { "payload.recipient": recipient.trim().toLowerCase(), "payload.subject": subject.trim(), "payload.body": body } }, { returnDocument: "after", runValidators: true }).lean();
  if (updated) return { status: "updated", pendingAction: { id: String(updated._id), recipient: updated.payload.recipient, subject: updated.payload.subject || "", body: updated.payload.body || "", expiresAt: updated.expiresAt } };
  const existing = await pendingSendModel.findOne({ _id: actionId, user: userId, conversationId }).lean();
  if (!existing) return { status: "not_found" };
  if (new Date(existing.expiresAt) <= now()) return { status: "expired" };
  return { status: "not_editable" };
};

const executeAction = createActionExecutor();

module.exports = { executeAction, createActionExecutor, sanitizeAuditMetadata, approvePendingSend, editPendingSend };
