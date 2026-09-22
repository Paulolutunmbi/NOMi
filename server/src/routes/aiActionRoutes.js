const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { createConversationContextService } = require("../services/conversations/conversationContextService");
const { createActionOrchestrator } = require("../services/actions/actionOrchestrator");
const { prepareAIInput, restorePlaceholders } = require("../services/privacy/privacyService");
const { createAIGateway } = require("../services/ai/aiGateway");
const { createGroqProvider } = require("../services/ai/groqProvider");
const { getAIConfig } = require("../config/ai");

const validConversationId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });

const createAIActionRouter = ({ gateway, contextService = createConversationContextService(), orchestrator, getUser = findOrCreateFromFirebaseClaims, config = getAIConfig(), authMiddleware } = {}) => {
  const router = express.Router();
  const requireAuth = authMiddleware || require("../middleware/auth");
  const actionOrchestrator = orchestrator || createActionOrchestrator({ contextService });
  router.post("/execute", requireAuth, async (req, res, next) => {
    const { conversationId, message, approval } = req.body || {};
    if (Object.keys(req.body || {}).some((key) => !["conversationId", "message", "approval"].includes(key))
      || !validConversationId(conversationId) || typeof message !== "string" || !message.trim() || message.length > 4000
      || (approval !== undefined && !["allow_once", "always_allow", "deny"].includes(approval))) return fail(res, 400, "AI_ACTION_REQUEST_INVALID", "A valid conversation and message are required.");
    try {
      const user = await getUser(req.user);
      let conversation = await contextService.getActive({ userId: user._id, conversationId });
      if (!conversation) conversation = await contextService.create({ userId: user._id, conversationId });
      const safe = prepareAIInput({ userRequest: message, untrustedRetrievedContent: (conversation.retrievedContext || []).slice(0, 5) });
      await contextService.update({ userId: user._id, conversationId, placeholderMappings: safe.mappings });
      const selectedGateway = gateway || createAIGateway({ providerName: config.provider, adapters: config.provider === "groq" ? { groq: createGroqProvider({ config }) } : {} });
      const planned = await selectedGateway.generateIntent({ safeInput: safe.payload, placeholderMappings: safe.mappings, trustedConversationContext: { gmailMessageIds: conversation.gmailMessageIds || [] } });
      if (planned.status !== "proposed") return fail(res, planned.status === "invalid" ? 422 : 503, planned.status === "invalid" ? "AI_INTENT_INVALID" : "AI_PROVIDER_ERROR", "The request could not be safely executed.");
      const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: restorePlaceholders(planned.intent, safe.mappings), approval });
      return res.status(outcome.status === "rejected" ? 422 : 200).json({ success: outcome.status === "success", outcome });
    } catch (error) { return next(error); }
  });
  return router;
};
module.exports = { createAIActionRouter };
