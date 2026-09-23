const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { createConversationContextService } = require("../services/conversations/conversationContextService");
const { createActionOrchestrator, isTrustedDraftSendFollowup } = require("../services/actions/actionOrchestrator");
const { prepareAIInput, restorePlaceholders } = require("../services/privacy/privacyService");
const { createAIGateway } = require("../services/ai/aiGateway");
const { createGroqProvider } = require("../services/ai/groqProvider");
const { getAIConfig } = require("../config/ai");

const validConversationId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const fail = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });
const ACTION_VERBS = /\b(craft|compose|draft|send|write|message|reply|respond|response|find|search|look\s+up|locate|read|check)\b/i;
const looksLikeAmbiguityResolution = (message) => {
  if (typeof message !== "string") return false;
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (ACTION_VERBS.test(trimmed)) return false;
  return trimmed.length <= 120;
};

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
      const recordOutcome = async (outcome) => {
        const previous = Array.isArray(conversation.messages) ? conversation.messages : [];
        const assistantText = String(outcome?.prompt || outcome?.message || outcome?.status || "Action completed.").slice(0, 4000);
        const messages = [...previous, { role: "user", content: message.trim() }, { role: "assistant", content: assistantText }].slice(-40);
        conversation.messages = messages;
        await contextService.update({ userId: user._id, conversationId, messages }).catch(() => {});
        return res.status(outcome.status === "rejected" ? 422 : 200).json({ success: outcome.status === "success", outcome });
      };

      // Only selection stages are deterministic. Previously any pending state
      // (including `draft_created`) entered this branch with proposal:null;
      // draft edits then fell through as invalid_proposal before the planner
      // could supply the revised body.
      if (["identity_selection", "conversation_selection"].includes(conversation.pendingInteraction?.stage)) {
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval });
        return recordOutcome(outcome);
      }

      // A trusted draft makes an explicit send command deterministic too. Its
      // IDs/body are recovered solely from server conversation state, before
      // any model call. Other draft follow-ups (for example tone edits) still
      // need planning for text interpretation and receive currentDraftBody.
      if (conversation.trustedDraft && isTrustedDraftSendFollowup(message)) {
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval });
        return recordOutcome(outcome);
      }

      // If waiting for candidate selection on an ambiguous compound reply,
      // route directly to the orchestrator without calling the AI gateway or performing a new search.
      // We only do this for short, non-action-verb messages that look like a selection ("1", "Paul", etc).
      if (conversation.pendingGmailReply && looksLikeAmbiguityResolution(message)) {
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval });
        return recordOutcome(outcome);
      }
      // Stale pending state with a new instruction: drop so the fresh proposal runs.
      if (conversation.pendingGmailReply && !looksLikeAmbiguityResolution(message)) {
        await contextService.update({ userId: user._id, conversationId, pendingGmailReply: null, pendingAmbiguity: null }).catch(() => {});
        conversation.pendingGmailReply = null;
        conversation.pendingAmbiguity = null;
      }

      // Non-compound pending ambiguity: route directly to orchestrator without re-calling AI.
      if (conversation.pendingAmbiguity && !conversation.pendingGmailReply && looksLikeAmbiguityResolution(message)) {
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval });
        return recordOutcome(outcome);
      }
      // Stale pendingAmbiguity with a new-style instruction: drop.
      if (conversation.pendingAmbiguity && !conversation.pendingGmailReply && !looksLikeAmbiguityResolution(message)) {
        await contextService.update({ userId: user._id, conversationId, pendingAmbiguity: null }).catch(() => {});
        conversation.pendingAmbiguity = null;
      }

      const safe = prepareAIInput({ userRequest: message, untrustedRetrievedContent: (conversation.retrievedContext || []).slice(0, 5) });
      await contextService.update({ userId: user._id, conversationId, placeholderMappings: safe.mappings });
      const selectedGateway = gateway || createAIGateway({ providerName: config.provider, adapters: config.provider === "groq" ? { groq: createGroqProvider({ config }) } : {} });
      const planned = await selectedGateway.generateIntent({ safeInput: safe.payload, placeholderMappings: safe.mappings,
        trustedConversationContext: { gmailMessageIds: conversation.gmailMessageIds || [], calendarEventIds: conversation.calendarEventIds || [], chatHistory: conversation.messages || [],
          currentDraftBody: conversation.trustedDraft?.body || null } });
      if (planned.status !== "proposed") return fail(res, planned.status === "invalid" ? 422 : 503, planned.status === "invalid" ? "AI_INTENT_INVALID" : "AI_PROVIDER_ERROR", "The request could not be safely executed.");
      const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: restorePlaceholders(planned.intent, safe.mappings), approval });
      return recordOutcome(outcome);
    } catch (error) { return next(error); }
  });
  return router;
};
module.exports = { createAIActionRouter };
