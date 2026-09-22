const crypto = require("crypto");
const TemporaryConversation = require("../../models/TemporaryConversation");

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const normalizeGmailMessageIds = (value) => [...new Set((Array.isArray(value) ? value : [])
  .filter((id) => typeof id === "string" && id.trim() && id.length <= 10000))].slice(0, 50);
const normalizeGmailCandidates = (value) => (Array.isArray(value) ? value : [])
  .filter((candidate) => candidate && typeof candidate.id === "string" && candidate.id.trim())
  .slice(0, 50)
  .map(({ id, email = null, displayName = null, subject = null, date = null, snippet = null }) => ({
    id, email: typeof email === "string" ? email.slice(0, 320) : null,
    displayName: typeof displayName === "string" ? displayName.slice(0, 320) : null,
    subject: typeof subject === "string" ? subject.slice(0, 500) : null,
    date: typeof date === "string" ? date.slice(0, 100) : null,
    snippet: typeof snippet === "string" ? snippet.slice(0, 1000) : null,
  }));
const normalizePendingGmailReply = (value) => {
  if (!value || typeof value !== "object") return null;
  const action = ["gmail.draft.reply", "gmail.send.reply"].includes(value.action) ? value.action : null;
  const body = typeof value.body === "string" && value.body.trim() ? value.body.slice(0, 10000) : null;
  return action && body ? { action, body } : null;
};
const createConversationContextService = (model = TemporaryConversation, { ttlMs = DEFAULT_TTL_MS, now = () => new Date() } = {}) => {
  const expiration = () => new Date(now().getTime() + ttlMs);
  const create = async ({ userId, conversationId = crypto.randomUUID() }) => model.create({ conversationId, user: userId, expiresAt: expiration() });
  const getActive = async ({ userId, conversationId }) => model.findOne({ conversationId, user: userId, expiresAt: { $gt: now() } });
  const update = async ({ userId, conversationId, messages, retrievedContext, placeholderMappings, gmailMessageIds, gmailCandidates, pendingGmailReply }) => {
    const updateData = { $set: { expiresAt: expiration() } };
    if (messages !== undefined) updateData.$set.messages = messages;
    if (retrievedContext !== undefined) updateData.$set.retrievedContext = retrievedContext;
    if (placeholderMappings !== undefined) updateData.$set.placeholderMappings = placeholderMappings;
    if (gmailMessageIds !== undefined) updateData.$set.gmailMessageIds = normalizeGmailMessageIds(gmailMessageIds);
    if (gmailCandidates !== undefined) updateData.$set.gmailCandidates = normalizeGmailCandidates(gmailCandidates);
    if (pendingGmailReply !== undefined) updateData.$set.pendingGmailReply = normalizePendingGmailReply(pendingGmailReply);
    return model.findOneAndUpdate({ conversationId, user: userId, expiresAt: { $gt: now() } }, updateData, { new: true });
  };
  const cleanupExpired = () => model.deleteMany({ expiresAt: { $lte: now() } });
  return { create, getActive, update, cleanupExpired };
};
module.exports = { createConversationContextService, DEFAULT_TTL_MS, normalizeGmailMessageIds, normalizeGmailCandidates, normalizePendingGmailReply };
