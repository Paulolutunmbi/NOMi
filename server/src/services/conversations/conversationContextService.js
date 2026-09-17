const crypto = require("crypto");
const TemporaryConversation = require("../../models/TemporaryConversation");

const DEFAULT_TTL_MS = 15 * 60 * 1000;
const createConversationContextService = (model = TemporaryConversation, { ttlMs = DEFAULT_TTL_MS, now = () => new Date() } = {}) => {
  const expiration = () => new Date(now().getTime() + ttlMs);
  const create = async ({ userId, conversationId = crypto.randomUUID() }) => model.create({ conversationId, user: userId, expiresAt: expiration() });
  const getActive = async ({ userId, conversationId }) => model.findOne({ conversationId, user: userId, expiresAt: { $gt: now() } });
  const update = async ({ userId, conversationId, messages, retrievedContext, placeholderMappings }) => {
    const updateData = { $set: { expiresAt: expiration() } };
    if (messages !== undefined) updateData.$set.messages = messages;
    if (retrievedContext !== undefined) updateData.$set.retrievedContext = retrievedContext;
    if (placeholderMappings !== undefined) updateData.$set.placeholderMappings = placeholderMappings;
    return model.findOneAndUpdate({ conversationId, user: userId, expiresAt: { $gt: now() } }, updateData, { new: true });
  };
  const cleanupExpired = () => model.deleteMany({ expiresAt: { $lte: now() } });
  return { create, getActive, update, cleanupExpired };
};
module.exports = { createConversationContextService, DEFAULT_TTL_MS };
