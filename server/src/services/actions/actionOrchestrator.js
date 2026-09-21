const { executeAction } = require("./actionExecutor");
const { resolveIdentity } = require("../identity/identityResolver");

const REPLY_ACTIONS = new Set(["gmail.draft.reply", "gmail.send.reply"]);
const MESSAGE_ACTIONS = new Set(["gmail.read", ...REPLY_ACTIONS]);
const SUPPORTED_ACTIONS = new Set(["gmail.search", "gmail.read", "gmail.draft", "gmail.send", ...REPLY_ACTIONS]);
const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const SECRET_KEYS = /token|credential|secret|authorization|api.?key|password/i;

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
const publicCandidate = ({ subject, date, snippet, displayName, email }) => ({ subject, date, snippet, from: displayName || email || null });
const safeResult = (result) => {
  if (!result || typeof result !== "object") return result || null;
  if (Array.isArray(result)) return result.map(safeResult);
  return Object.fromEntries(Object.entries(result)
    .filter(([key]) => !SECRET_KEYS.test(key) && key !== "auditMetadata" && key !== "id" && key !== "messageId")
    .map(([key, value]) => [key, safeResult(value)]));
};
const replyIdentityQuery = (message) => {
  const match = typeof message === "string" && message.match(/\breply\s+(?:to\s+)?([A-Za-z][A-Za-z .'-]{1,80}?)(?:\s+(?:about|regarding|on|with)\b|[.!?,]|$)/i);
  return match ? match[1].trim() : null;
};
const payloadFor = (intent) => {
  const { action, parameters } = intent;
  if (action === "gmail.search") return { query: parameters.query, maxResults: parameters.maxResults || undefined };
  if (action === "gmail.read") return { messageId: parameters.messageId };
  if (REPLY_ACTIONS.has(action)) return { messageId: parameters.messageId, body: parameters.body };
  return { recipient: parameters.recipient, subject: parameters.subject || undefined, body: parameters.body };
};

const createActionOrchestrator = ({ contextService, actionExecutor = executeAction, resolve = resolveIdentity } = {}) => {
  if (!contextService) throw new Error("contextService is required");
  const selectReplyCandidate = (message, conversation) => {
    const query = replyIdentityQuery(message);
    const candidates = Array.isArray(conversation.gmailCandidates) ? conversation.gmailCandidates : [];
    if (!query || !candidates.length) return { status: "none" };
    return resolve({ query, candidates });
  };

  const execute = async ({ user, conversationId, message, proposal, conversation, approval }) => {
    if (!proposal || !proposal.action || !proposal.parameters) return { status: "invalid", reason: "invalid_proposal" };
    if (!SUPPORTED_ACTIONS.has(proposal.action)) return { status: "rejected", reason: "unsupported_action" };
    let activeConversation = conversation || await contextService.getActive({ userId: user._id, conversationId });
    if (!activeConversation) activeConversation = await contextService.create({ userId: user._id, conversationId });
    const intent = { action: proposal.action, parameters: { ...proposal.parameters } };

    if (REPLY_ACTIONS.has(intent.action)) {
      const resolution = selectReplyCandidate(message, activeConversation);
      if (resolution.status === "ambiguous") return { status: "ambiguous_identity", candidates: resolution.candidates.map(publicCandidate) };
      if (resolution.status === "resolved") intent.parameters.messageId = resolution.identity.id;
    }
    // Recheck at the execution boundary. The model's validated proposal is
    // never enough by itself, and client input has no path to this value.
    if (MESSAGE_ACTIONS.has(intent.action)
      && !(activeConversation.gmailMessageIds || []).includes(intent.parameters.messageId)) {
      return { status: "rejected", reason: "untrusted_or_unknown_message_id" };
    }
    if (["gmail.draft", "gmail.send"].includes(intent.action)
      && (!EMAIL.test(intent.parameters.recipient || "") || !message.toLowerCase().includes(intent.parameters.recipient.toLowerCase()))) {
      return { status: "rejected", reason: "untrusted_recipient_email" };
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
    }
    return { status: "success", action: intent.action, result: intent.action === "gmail.search"
      ? { messages: candidates.map(publicCandidate), count: candidates.length }
      : safeResult(execution.result) };
  };
  return { execute };
};

module.exports = { createActionOrchestrator, normalizedCandidates, safeResult, replyIdentityQuery };
