const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { createConversationContextService } = require("../services/conversations/conversationContextService");
const { createActionOrchestrator, SEND_FOLLOWUP } = require("../services/actions/actionOrchestrator");
const { prepareAIInput, restorePlaceholders } = require("../services/privacy/privacyService");
const { createAIGateway } = require("../services/ai/aiGateway");
const { createGroqProvider } = require("../services/ai/groqProvider");
const { getAIConfig } = require("../config/ai");
const mongoose = require("mongoose");
const ChatSession = require("../models/ChatSession");

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
const explicitRecipient = (message) => {
  const match = String(message || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
};
const explicitBody = (message) => {
  const cleaned = String(message || "").replace(/\[[^\]]+\]\(mailto:[^)]+\)/ig, " ").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, " ");
  const match = cleaned.match(/\b(?:saying|that)\s+(.+?)(?:\s*,?\s*(?:him|her|them))?\s*[.!?]*$/i);
  const pronounTell = cleaned.match(/\btell\s+(?:him|her|them|this person|that person)\s+(?:that\s+)?(.+?)[.!?]*$/i);
  return (match?.[1] || pronounTell?.[1] || null)?.trim().replace(/[\s,]+$/, "") || null;
};

const createAIActionRouter = ({ gateway, contextService = createConversationContextService(), orchestrator, getUser = findOrCreateFromFirebaseClaims, config = getAIConfig(), authMiddleware } = {}) => {
  const router = express.Router();
  const requireAuth = authMiddleware || require("../middleware/auth");
  const actionOrchestrator = orchestrator || createActionOrchestrator({ contextService });
  router.post("/execute", requireAuth, async (req, res, next) => {
    const { conversationId, message, approval, attachmentIds } = req.body || {};
    if (Object.keys(req.body || {}).some((key) => !["conversationId", "message", "approval", "attachmentIds"].includes(key))
      || !validConversationId(conversationId) || typeof message !== "string" || !message.trim() || message.length > 4000
      || (approval !== undefined && !["allow_once", "always_allow", "deny"].includes(approval))
      || (attachmentIds !== undefined && (!Array.isArray(attachmentIds) || attachmentIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 100)))) {
      return fail(res, 400, "AI_ACTION_REQUEST_INVALID", "A valid conversation and message are required.");
    }
    try {
      const user = await getUser(req.user);
      let persistentChat = null;
      // New clients pass the Mongo chat document ID. Keep compatibility with
      // legacy non-ObjectId test/workspace IDs, but never accept an unknown
      // ObjectId or a chat owned by another NOMI account.
      if (mongoose.isValidObjectId(conversationId)) {
        persistentChat = await ChatSession.findOne({ _id: conversationId, user: user._id });
        if (!persistentChat) return fail(res, 404, "CHAT_NOT_FOUND", "This chat could not be found. Refresh the workspace and try again.");
      }
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

      // Pending interaction selections are deterministic and never invoke the
      // AI planner. This includes "the second one" at either stage.
      const isSelectionStage = conversation.pendingInteraction
        && ["identity_selection", "conversation_selection", "no_history"].includes(conversation.pendingInteraction.stage);
      const isTrustedSend = conversation.trustedDraft && SEND_FOLLOWUP.test(message);
      const isCalendarSelection = /^calendar_select:\d+$/.test(message) && Array.isArray(conversation.calendarCandidates);

      if (isSelectionStage || isTrustedSend || isCalendarSelection) {
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval, attachmentIds });
        return recordOutcome(outcome);
      }

      // If waiting for candidate selection on an ambiguous compound reply,
      // route directly to the orchestrator without calling the AI gateway or performing a new search.
      // We only do this for short, non-action-verb messages that look like a selection ("1", "Paul", etc).
      if (conversation.pendingGmailReply && looksLikeAmbiguityResolution(message)) {
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval, attachmentIds });
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
        const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: null, approval, attachmentIds });
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
        trustedConversationContext: { gmailMessageIds: conversation.gmailMessageIds || [], trustedGmailPerson: conversation.trustedGmailPerson || null, calendarEventIds: conversation.calendarEventIds || [], trustedCalendarEvent: conversation.trustedCalendarEvent || null, chatHistory: conversation.messages || [],
          rollingSummary: persistentChat?.summary || null,
          currentDraftBody: conversation.trustedDraft?.body || null } });
      if (planned.status !== "proposed") return fail(res, planned.status === "invalid" ? 422 : 503, planned.status === "invalid" ? "AI_INTENT_INVALID" : "AI_PROVIDER_ERROR", "The request could not be safely executed.");
      const intent = restorePlaceholders(planned.intent, safe.mappings);
      // Keep an explicitly typed recipient deterministic. The planner can
      // choose the action/body, but cannot lose an address the user supplied.
      const recipient = explicitRecipient(message);
      if (recipient && ["gmail.draft", "gmail.send"].includes(intent.action)) intent.parameters.recipient = recipient;
      else if (conversation.trustedGmailPerson?.email && ["gmail.draft", "gmail.send"].includes(intent.action)) intent.parameters.recipient = conversation.trustedGmailPerson.email;
      const knownRecipient = recipient || conversation.trustedGmailPerson?.email;
      if (knownRecipient && intent.action === "clarification" && /\b(?:tell|draft|write|compose|send)\b/i.test(message)) {
        const body = explicitBody(message);
        if (body) {
          intent.action = "gmail.draft";
          intent.parameters = { ...intent.parameters, recipient: knownRecipient, body, subject: intent.parameters.subject || null };
        }
      }
      const outcome = await actionOrchestrator.execute({ user, conversationId, message, conversation, proposal: intent, approval, attachmentIds });
      return recordOutcome(outcome);
    } catch (error) { return next(error); }
  });
  return router;
};
module.exports = { createAIActionRouter, explicitRecipient, explicitBody };
