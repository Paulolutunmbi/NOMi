const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { createConversationContextService } = require("../services/conversations/conversationContextService");
const { prepareAIInput, restorePlaceholders } = require("../services/privacy/privacyService");
const { createAIGateway } = require("../services/ai/aiGateway");
const { createGroqProvider } = require("../services/ai/groqProvider");
const { getAIConfig } = require("../config/ai");
const { writeAIAudit } = require("../services/ai/aiAuditService");
const { extractExplicitRecipientEmail } = require("../services/ai/intentSafetyPolicy");

const MAX_MESSAGE_LENGTH = 4000;
const validConversationId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const clientError = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });

const createAIIntentRouter = ({ gateway, contextService = createConversationContextService(), audit = writeAIAudit, getUser = findOrCreateFromFirebaseClaims, config = getAIConfig(), authMiddleware } = {}) => {
  const router = express.Router();
  // Delay Firebase module loading so route behavior remains unit-testable
  // without credentials; production continues to use the same middleware.
  const requireAuth = authMiddleware || require("../middleware/auth");
  router.post("/intent", requireAuth, async (req, res, next) => {
    const { conversationId, message } = req.body || {};
    if (Object.keys(req.body || {}).some((key) => !["conversationId", "message"].includes(key)) || !validConversationId(conversationId) || typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
      return clientError(res, 400, "AI_REQUEST_INVALID", "A valid conversation and message are required.");
    }
    let user;
    try {
      user = await getUser(req.user);
      let conversation = await contextService.getActive({ userId: user._id, conversationId });
      if (!conversation) conversation = await contextService.create({ userId: user._id, conversationId });
      const safe = prepareAIInput({ userRequest: message, untrustedRetrievedContent: (conversation.retrievedContext || []).slice(0, 5).map(({ source, content }) => ({ source, content: String(content || "").slice(0, 2000) })) });
      // Mappings are retained only in the TTL-backed conversation record; they
      // are never part of the model payload, audit record, or API response.
      await contextService.update({ userId: user._id, conversationId, placeholderMappings: safe.mappings });
      const selectedGateway = gateway || createAIGateway({ providerName: config.provider, adapters: config.provider === "groq" ? { groq: createGroqProvider({ config }) } : {} });
      // The client can never supply this data: it is read from the matching
      // user-bound TTL record and normalized again at the prompt boundary.
      const result = await selectedGateway.generateIntent({
        safeInput: safe.payload,
        placeholderMappings: safe.mappings,
        originalUserRequest: message,
        explicitRecipientEmail: extractExplicitRecipientEmail(message),
        trustedConversationContext: { gmailMessageIds: conversation.gmailMessageIds || [], calendarEventIds: conversation.calendarEventIds || [] },
      });
      if (result.status === "proposed") {
        const intent = restorePlaceholders(result.intent, safe.mappings);
        await audit({ user, provider: config.provider, conversationId, outcome: "success" }).catch(() => {});
        return res.status(200).json({ success: true, intent });
      }
      const validationFailure = result.status === "invalid";
      await audit({ user, provider: config.provider, conversationId, outcome: "failure", reason: result.reason }).catch(() => {});
      return clientError(res, validationFailure ? 422 : 503, validationFailure ? "AI_INTENT_INVALID" : "AI_PROVIDER_ERROR", validationFailure ? "The request could not be converted into a valid NOMI action." : "Unable to process the request right now.");
    } catch (error) {
      if (error.code?.startsWith("ai_provider_")) return clientError(res, 503, "AI_PROVIDER_ERROR", "Unable to process the request right now.");
      return next(error);
    }
  });
  return router;
};
module.exports = { createAIIntentRouter, MAX_MESSAGE_LENGTH };
