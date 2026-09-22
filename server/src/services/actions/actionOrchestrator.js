const { executeAction } = require("./actionExecutor");
const { resolveIdentity } = require("../identity/identityResolver");
const { isSelfRecipientMarker } = require("../ai/intentValidator");

const REPLY_ACTIONS = new Set(["gmail.draft.reply", "gmail.send.reply"]);
const MESSAGE_ACTIONS = new Set(["gmail.read", ...REPLY_ACTIONS]);
// Compound intents: model proposes search query + reply body; the orchestrator
// resolves the trusted target server-side and then executes the reply.
const SEARCH_THEN_REPLY_ACTIONS = new Set(["gmail.search_then_reply", "gmail.search_then_draft_reply", "gmail.search_then_send_reply"]);
const SUPPORTED_ACTIONS = new Set(["gmail.search", "gmail.read", "gmail.draft", "gmail.send", "clarification", ...REPLY_ACTIONS, ...SEARCH_THEN_REPLY_ACTIONS]);
const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const SECRET_KEYS = /token|credential|secret|authorization|api.?key|password/i;
const PRONOUN_MATCH = /\b(him|her|them|that\s+person|this\s+person|the\s+sender)\b/i;
const PRONOUN_REPLY = /^(?:him|her|them|that\s+person|this\s+person|the\s+sender)$/i;
const isSelfRecipient = ({ recipient } = {}) => isSelfRecipientMarker(recipient);

const cleanText = (value, max) => typeof value === "string" ? value.slice(0, max) : null;
const providerMessages = (result) => {
  const messages = result?.messages || result?.data?.messages || [];
  return Array.isArray(messages) ? messages : [];
};
const normalizedCandidates = (result) => providerMessages(result)
  .filter((message) => typeof message?.id === "string" && message.id.trim())
  .slice(0, 50)
  .map((message) => ({
    id: message.id,
    email: cleanText(message.from?.email || message.fromEmail || message.email, 320),
    displayName: cleanText(message.from?.name || message.fromName || message.displayName || message.from, 320),
    subject: cleanText(message.subject, 500), date: cleanText(message.date, 100), snippet: cleanText(message.snippet, 1000),
  }));
const publicCandidate = ({ subject, date, displayName, email }) => ({
  name: displayName || null, email: email || null, subject: subject || null, date: date || null,
});
const candidatePrompt = (query, candidates) => {
  const numbered = candidates.map((candidate, index) => `${index + 1}. ${candidate.displayName || "Unknown sender"}${candidate.email ? ` <${candidate.email}>` : ""}${candidate.subject ? ` — \"${candidate.subject}\"` : ""}`).join("\n");
  return `I found multiple possible matches${query ? ` for ${query}` : ""}. Which one should I reply to?\n\n${numbered}\n\nReply with the number or the person's email.`;
};
const safeResult = (result) => {
  if (!result || typeof result !== "object") return result || null;
  if (Array.isArray(result)) return result.map(safeResult);
  return Object.fromEntries(Object.entries(result)
    .filter(([key]) => !SECRET_KEYS.test(key) && key !== "auditMetadata" && key !== "id" && key !== "messageId")
    .map(([key, value]) => [key, safeResult(value)]));
};
const replyIdentityQuery = (message) => {
  if (typeof message !== "string") return null;
  const pronounMatch = message.match(PRONOUN_MATCH);
  if (pronounMatch) return pronounMatch[1].trim();

  const namedMatch = message.match(/\b(?:reply|response)\s+(?:to\s+)?([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:about|regarding|on|with|saying|telling|that)\b|[.!?,]|$)/i)
    || message.match(/\b(?:tell|telling)\s+([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:that|about|regarding|to|I|i|we|they|he|she)\b|[.!?,]|$)/i)
    || message.match(/\b(?:craft|compose|draft|send|write|message)\s+(?:a\s+)?(?:message|email|note|reply|response)?\s*(?:to\s+|for\s+|telling\s+)?([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:about|regarding|on|with|saying|telling|that)\b|[.!?,]|$)/i);
  return namedMatch ? namedMatch[1].trim() : null;
};
const payloadFor = (intent) => {
  const { action, parameters } = intent;
  if (action === "gmail.search") return { query: parameters.query, maxResults: parameters.maxResults || undefined };
  if (action === "gmail.read") return { messageId: parameters.messageId };
  if (REPLY_ACTIONS.has(action)) return { messageId: parameters.messageId, body: parameters.body };
  return { recipient: parameters.recipient, subject: parameters.subject || undefined, body: parameters.body };
};
// Map a compound search_then_* action to the corresponding reply action.
const replyActionFor = (compoundAction) => {
  if (compoundAction === "gmail.search_then_send_reply") return "gmail.send.reply";
  return "gmail.draft.reply"; // search_then_reply and search_then_draft_reply both draft
};

const createActionOrchestrator = ({ contextService, actionExecutor = executeAction, resolve = resolveIdentity } = {}) => {
  if (!contextService) throw new Error("contextService is required");
  const selectReplyCandidate = (message, conversation) => {
    const query = replyIdentityQuery(message);
    const candidates = Array.isArray(conversation.gmailCandidates) ? conversation.gmailCandidates : [];
    if (!candidates.length) {
      if (Array.isArray(conversation.gmailMessageIds) && conversation.gmailMessageIds.length === 1) {
        return { status: "resolved", identity: { id: conversation.gmailMessageIds[0] } };
      }
      return { status: "none" };
    }
    if (!query || PRONOUN_REPLY.test(query)) {
      if (candidates.length === 1) return { status: "resolved", identity: candidates[0] };
      return { status: "ambiguous", candidates };
    }
    const match = resolve({ query, candidates });
    if (match.status === "resolved") return match;
    if (match.status === "ambiguous") return match;
    return match;
  };
  const selectPendingCandidate = (message, candidates) => {
    const choice = typeof message === "string" ? message.trim() : "";
    const numbered = choice.match(/^(?:#?\s*)?(\d+)(?:\s*(?:st|nd|rd|th))?(?:\s+(?:one|option))?$/i)
      || choice.match(/^(?:the\s+)?(first|second|third|fourth|fifth)\s+(?:one|option)$/i);
    if (numbered) {
      const labels = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5 };
      const index = Number(numbered[1]) || labels[String(numbered[1]).toLowerCase()];
      return candidates[index - 1] ? { status: "resolved", identity: candidates[index - 1] } : { status: "invalid_selection" };
    }
    if (!choice) return { status: "invalid_selection" };
    const resolution = resolve({ query: choice, candidates });
    return resolution.status === "resolved" ? resolution : { status: resolution.status === "ambiguous" ? "ambiguous" : "invalid_selection", candidates: resolution.candidates };
  };
  const executePendingReply = async ({ user, conversationId, message, conversation, approval }) => {
    const pending = conversation.pendingGmailReply;
    if (!pending) return null;
    const candidates = Array.isArray(conversation.gmailCandidates) ? conversation.gmailCandidates : [];
    const selection = selectPendingCandidate(message, candidates);
    if (selection.status !== "resolved") {
      return {
        status: selection.status === "ambiguous" ? "ambiguous_identity" : "clarification",
        action: pending.action,
        candidates: candidates.map(publicCandidate),
        prompt: candidatePrompt(null, candidates),
      };
    }
    const trustedMessageId = selection.identity.id;
    const execution = await actionExecutor({ user, provider: "google", action: pending.action,
      payload: { messageId: trustedMessageId, body: pending.body }, target: { type: "gmail_message", id: trustedMessageId }, approval });
    if (execution.status !== "success") return { status: execution.status, action: pending.action };
    await contextService.update({ userId: user._id, conversationId, pendingGmailReply: null });
    return { status: "success", action: pending.action, result: safeResult(execution.result) };
  };

  // Executes the compound "search then reply" flow:
  //   1. Runs gmail.search under the search permission.
  //   2. Stores trusted candidates in the user's conversation context.
  //   3. Resolves identity deterministically.
  //   4. Continues to gmail.draft.reply / gmail.send.reply under the reply permission.
  // No permission is ever conflated: search needs its own grant, reply needs its own grant.
  const executeSearchThenReply = async ({ user, conversationId, intent, activeConversation, approval }) => {
    const replyAction = replyActionFor(intent.action);
    const searchPayload = { query: intent.parameters.query, maxResults: intent.parameters.maxResults || undefined };
    const searchTarget = { type: "gmail", id: null, label: null };
    // Step 1 — execute gmail.search (subject to its own permission check)
    const searchExecution = await actionExecutor({ user, provider: "google", action: "gmail.search", payload: searchPayload, target: searchTarget, approval });
    if (searchExecution.status !== "success") {
      return { status: searchExecution.status, action: intent.action };
    }
    // Step 2 — store server-trusted candidates in conversation context
    const candidates = normalizedCandidates(searchExecution.result);
    if (candidates.length) {
      const retrievedContext = candidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
      await contextService.update({ userId: user._id, conversationId, gmailMessageIds: candidates.map(({ id }) => id), gmailCandidates: candidates, retrievedContext });
    }
    // Step 3 — identity resolution
    if (!candidates.length) {
      return { status: "not_found", action: intent.action, message: "I couldn't find any emails matching that search." };
    }
    // The model's search query is retrieval criteria, not an identity. Reuse
    // the existing unspecified-target reply selection against provider-derived
    // candidates: exactly one is trusted; zero or many stay unresolved.
    const resolution = selectReplyCandidate(null, {
      gmailMessageIds: candidates.map(({ id }) => id),
      gmailCandidates: candidates,
    });
    if (resolution.status === "ambiguous") {
      await contextService.update({ userId: user._id, conversationId, pendingGmailReply: { action: replyAction, body: intent.parameters.body } });
      return {
        status: "ambiguous_identity",
        action: intent.action,
        candidates: resolution.candidates.map(publicCandidate),
        prompt: candidatePrompt(intent.parameters.query, resolution.candidates),
      };
    }
    if (resolution.status !== "resolved") {
      return { status: "not_found", action: intent.action, message: "I couldn't identify a unique recipient from the search results." };
    }
    // Step 4 — execute the reply under its own independent permission check.
    // The server-trusted message ID comes from resolution.identity.id (never from the model or client).
    const trustedMessageId = resolution.identity.id;
    const replyTarget = { type: "gmail_message", id: trustedMessageId };
    const replyPayload = { messageId: trustedMessageId, body: intent.parameters.body };
    const replyExecution = await actionExecutor({ user, provider: "google", action: replyAction, payload: replyPayload, target: replyTarget, approval });
    if (replyExecution.status !== "success") {
      return { status: replyExecution.status, action: replyAction };
    }
    return { status: "success", action: replyAction, result: safeResult(replyExecution.result) };
  };

  const execute = async ({ user, conversationId, message, proposal, conversation, approval }) => {
    if (!proposal || !proposal.action || !proposal.parameters) return { status: "invalid", reason: "invalid_proposal" };
    if (!SUPPORTED_ACTIONS.has(proposal.action)) return { status: "rejected", reason: "unsupported_action" };
    let activeConversation = conversation || await contextService.getActive({ userId: user._id, conversationId });
    if (!activeConversation) activeConversation = await contextService.create({ userId: user._id, conversationId });
    const intent = { action: proposal.action, parameters: { ...proposal.parameters } };

    // A prior compound search may be waiting for an explicit user selection.
    // This runs before interpreting the newly generated proposal, so "1" cannot
    // trigger a fresh search or introduce a model/client-supplied Gmail ID.
    if (activeConversation.pendingGmailReply) {
      return executePendingReply({ user, conversationId, message, conversation: activeConversation, approval });
    }

    // ── Compound search-then-reply flow ──────────────────────────────────────
    if (SEARCH_THEN_REPLY_ACTIONS.has(intent.action)) {
      return executeSearchThenReply({ user, conversationId, intent, activeConversation, approval });
    }

    if (intent.action === "clarification") {
      const clarificationText = cleanText(intent.parameters?.body, 1000) || "Who would you like me to send this to?";
      return {
        status: "clarification",
        action: "clarification",
        message: clarificationText,
        prompt: clarificationText,
      };
    }

    if (REPLY_ACTIONS.has(intent.action)) {
      const resolution = selectReplyCandidate(message, activeConversation);
      if (resolution.status === "ambiguous") return { status: "ambiguous_identity", candidates: resolution.candidates.map(publicCandidate), prompt: candidatePrompt(null, resolution.candidates) };
      if (resolution.status === "resolved") intent.parameters.messageId = resolution.identity.id;
    }
    // Recheck at the execution boundary. The model's validated proposal is
    // never enough by itself, and client input has no path to this value.
    if (MESSAGE_ACTIONS.has(intent.action)
      && !(activeConversation.gmailMessageIds || []).includes(intent.parameters.messageId)) {
      return { status: "rejected", reason: "untrusted_or_unknown_message_id" };
    }
    if (["gmail.draft", "gmail.send"].includes(intent.action)) {
      if (isSelfRecipient({ recipient: intent.parameters.recipient })) {
        const userEmail = typeof user?.email === "string" && EMAIL.test(user.email.trim()) ? user.email.trim().toLowerCase() : null;
        if (!userEmail) return { status: "rejected", reason: "untrusted_recipient_email" };
        intent.parameters.recipient = userEmail;
      } else if (!EMAIL.test(intent.parameters.recipient || "") || !message.toLowerCase().includes(intent.parameters.recipient.toLowerCase())) {
        return { status: "rejected", reason: "untrusted_recipient_email" };
      }
    }
    const target = MESSAGE_ACTIONS.has(intent.action)
      ? { type: "gmail_message", id: intent.parameters.messageId }
      : { type: "gmail", id: null, label: null };
    const execution = await actionExecutor({ user, provider: "google", action: intent.action, payload: payloadFor(intent), target, approval });
    if (execution.status !== "success") return { status: execution.status, action: intent.action };

    const candidates = intent.action === "gmail.search" ? normalizedCandidates(execution.result) : [];
    if (candidates.length) {
      const retrievedContext = candidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
      await contextService.update({ userId: user._id, conversationId, gmailMessageIds: candidates.map(({ id }) => id), gmailCandidates: candidates, retrievedContext });
    } else if (intent.action === "gmail.read" && execution.result?.message) {
      const msg = execution.result.message;
      const emailMatch = typeof msg.sender === "string" ? msg.sender.match(/<([^<>]+)>/)?.[1] || (EMAIL.test(msg.sender) ? msg.sender : null) : null;
      const nameClean = typeof msg.sender === "string" ? msg.sender.replace(/<[^>]+>/, "").trim() : null;
      const readCandidate = {
        id: msg.id,
        email: cleanText(emailMatch, 320),
        displayName: cleanText(nameClean || msg.sender, 320),
        subject: cleanText(msg.subject, 500),
        date: cleanText(msg.date, 100),
        snippet: cleanText(msg.snippet, 1000),
      };
      const existingCandidates = Array.isArray(activeConversation.gmailCandidates) ? activeConversation.gmailCandidates : [];
      const updatedCandidates = [readCandidate, ...existingCandidates.filter((c) => c.id !== readCandidate.id)].slice(0, 50);
      const existingIds = Array.isArray(activeConversation.gmailMessageIds) ? activeConversation.gmailMessageIds : [];
      const updatedIds = [...new Set([readCandidate.id, ...existingIds])].slice(0, 50);
      const retrievedContext = updatedCandidates.map(({ id, ...candidate }) => ({ source: "gmail", content: JSON.stringify(candidate) }));
      await contextService.update({ userId: user._id, conversationId, gmailMessageIds: updatedIds, gmailCandidates: updatedCandidates, retrievedContext });
    }
    return { status: "success", action: intent.action, result: intent.action === "gmail.search"
      ? { messages: candidates.map(publicCandidate), count: candidates.length }
      : safeResult(execution.result) };
  };
  return { execute };
};

module.exports = { createActionOrchestrator, normalizedCandidates, safeResult, replyIdentityQuery, isSelfRecipient, replyActionFor, SEARCH_THEN_REPLY_ACTIONS };
