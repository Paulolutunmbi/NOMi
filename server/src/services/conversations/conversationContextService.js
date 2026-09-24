const crypto = require("crypto");
const TemporaryConversation = require("../../models/TemporaryConversation");

// Trusted provider selections and pending actions must survive normal visits.
// Durable user-visible messages live in ChatMessage; this record is the
// account-scoped server authorization context for subsequent actions.
const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const normalizeGmailMessageIds = (value) => [...new Set((Array.isArray(value) ? value : [])
  .filter((id) => typeof id === "string" && id.trim() && id.length <= 10000))].slice(0, 50);
const normalizeGmailCandidates = (value) => (Array.isArray(value) ? value : [])
  .filter((candidate) => candidate && typeof candidate.id === "string" && candidate.id.trim())
  .slice(0, 50)
  .map(({ id, email = null, displayName = null, subject = null, date = null, snippet = null, participants = [] }) => ({
    id, email: typeof email === "string" ? email.slice(0, 320) : null,
    displayName: typeof displayName === "string" ? displayName.slice(0, 320) : null,
    participants: (Array.isArray(participants) ? participants : []).slice(0, 20).map((person) => ({
      email: typeof person?.email === "string" ? person.email.slice(0, 320) : null,
      displayName: typeof person?.displayName === "string" ? person.displayName.slice(0, 320) : null,
    })),
    subject: typeof subject === "string" ? subject.slice(0, 500) : null,
    date: typeof date === "string" ? date.slice(0, 100) : null,
    snippet: typeof snippet === "string" ? snippet.slice(0, 1000) : null,
  }));
// Same trust pattern as gmailMessageIds/gmailCandidates, for Calendar.
const normalizeCalendarEventIds = (value) => [...new Set((Array.isArray(value) ? value : [])
  .filter((id) => typeof id === "string" && id.trim() && id.length <= 1024))].slice(0, 50);
const normalizeCalendarCandidates = (value) => (Array.isArray(value) ? value : [])
  .filter((candidate) => candidate && typeof candidate.id === "string" && candidate.id.trim())
  .slice(0, 50)
  .map(({ id, summary = null, start = null, end = null, location = null }) => ({
    id, summary: typeof summary === "string" ? summary.slice(0, 500) : null,
    start: typeof start === "string" ? start.slice(0, 100) : null,
    end: typeof end === "string" ? end.slice(0, 100) : null,
    location: typeof location === "string" ? location.slice(0, 500) : null,
  }));
const normalizeTrustedCalendarEvent = (value) => value && typeof value.id === "string" && value.id.trim() ? {
  id: value.id.slice(0, 1024), summary: typeof value.summary === "string" ? value.summary.slice(0, 500) : null,
  start: typeof value.start === "string" ? value.start.slice(0, 100) : null,
  end: typeof value.end === "string" ? value.end.slice(0, 100) : null,
  location: typeof value.location === "string" ? value.location.slice(0, 500) : null,
} : null;
const normalizeMessages = (value) => (Array.isArray(value) ? value : [])
  .filter((message) => message && typeof message.content === "string" && (!message.role || ["user", "assistant"].includes(message.role)))
  .slice(-40)
  .map((message) => ({ role: message.role || "user", content: message.content.slice(0, 4000) }));
const normalizePendingGmailReply = (value) => {
  if (!value || typeof value !== "object") return null;
  const action = ["gmail.draft.reply", "gmail.send.reply"].includes(value.action) ? value.action : null;
  const body = typeof value.body === "string" && value.body.trim() ? value.body.slice(0, 10000) : null;
  return action && body ? { action, body } : null;
};
const normalizeTrustedTarget = (value) => {
  if (!value || typeof value !== "object") return null;
  const type = typeof value.type === "string" && ["gmail_message"].includes(value.type) ? value.type : null;
  const messageId = typeof value.messageId === "string" && value.messageId.trim() ? value.messageId.slice(0, 200) : null;
  const threadId = typeof value.threadId === "string" && value.threadId.trim() ? value.threadId.slice(0, 200) : null;
  const email = typeof value.email === "string" && value.email.trim() ? value.email.slice(0, 320) : null;
  const subject = typeof value.subject === "string" ? value.subject.slice(0, 500) : null;
  if (!type || !messageId) return null;
  return { type, messageId, threadId, email, subject };
};
const normalizeTrustedGmailPerson = (value) => value && typeof value.email === "string" && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value.email)
  ? { email: value.email.toLowerCase(), name: typeof value.name === "string" ? value.name.slice(0, 320) : null } : null;
const normalizeTrustedDraft = (value) => {
  if (!value || typeof value !== "object") return null;
  const draftId = typeof value.draftId === "string" && value.draftId.trim() ? value.draftId.slice(0, 200) : null;
  const threadId = typeof value.threadId === "string" && value.threadId.trim() ? value.threadId.slice(0, 200) : null;
  const messageId = typeof value.messageId === "string" && value.messageId.trim() ? value.messageId.slice(0, 200) : null;
  const recipient = typeof value.recipient === "string" && value.recipient.trim() ? value.recipient.slice(0, 320) : null;
  const subject = typeof value.subject === "string" ? value.subject.slice(0, 500) : null;
  const action = ["gmail.draft", "gmail.send", "gmail.draft.reply", "gmail.send.reply"].includes(value.action) ? value.action : null;
  const body = typeof value.body === "string" ? value.body.slice(0, 20 * 1024) : null;
  if (!action || !(draftId || messageId)) return null;
  const attachments = Array.isArray(value.attachments)
    ? value.attachments
        .filter((a) => a && typeof a === "object" && typeof a.filename === "string")
        .slice(0, 10)
        .map((a) => ({
          id: typeof a.id === "string" ? a.id.slice(0, 100) : undefined,
          filename: a.filename.slice(0, 255),
          mimeType: typeof a.mimeType === "string" ? a.mimeType.slice(0, 100) : "image/jpeg",
          size: Number.isInteger(a.size) ? a.size : undefined,
        }))
    : [];
  return { draftId, threadId, messageId, recipient, subject, action, body, attachments };
};
const normalizePendingAmbiguity = (value) => {
  if (!value || typeof value !== "object") return null;
  const action = ["gmail.draft.reply", "gmail.send.reply", "gmail.draft", "gmail.send"].includes(value.action) ? value.action : null;
  const body = typeof value.body === "string" ? value.body.slice(0, 10000) : null;
  const recipient = typeof value.recipient === "string" ? value.recipient.slice(0, 320) : null;
  const ambiguityType = ["identity", "message"].includes(value.ambiguityType) ? value.ambiguityType : "identity";
  if (!action) return null;
  const result = { action, body, ambiguityType };
  if (recipient) result.recipient = recipient;
  if (typeof value.subject === "string") result.subject = value.subject.slice(0, 500);
  if (Array.isArray(value.candidateSelectionList)) {
    result.candidateSelectionList = value.candidateSelectionList
      .filter((c) => c && typeof c.id === "string" && c.id.trim())
      .slice(0, 50)
      .map(({ id, email = null, displayName = null, subject = null, date = null, threadId = null, snippet = null, participants = [] }) => ({
        id: id.slice(0, 200),
        threadId: typeof threadId === "string" ? threadId.slice(0, 200) : null,
        email: typeof email === "string" ? email.slice(0, 320) : null,
        displayName: typeof displayName === "string" ? displayName.slice(0, 320) : null,
        participants: (Array.isArray(participants) ? participants : []).slice(0, 20).map((person) => ({
          email: typeof person?.email === "string" ? person.email.slice(0, 320) : null,
          displayName: typeof person?.displayName === "string" ? person.displayName.slice(0, 320) : null,
        })),
        subject: typeof subject === "string" ? subject.slice(0, 500) : null,
        date: typeof date === "string" ? date.slice(0, 100) : null,
        snippet: typeof snippet === "string" ? snippet.slice(0, 1000) : null,
      }));
  }
  return result;
};
const normalizePendingInteraction = (value) => {
  if (!value || typeof value !== "object") return null;
  const stage = ["identity_selection", "conversation_selection", "no_history", "draft_created", "awaiting_confirmation", "completed"].includes(value.stage) ? value.stage : null;
  const action = ["gmail.draft.reply", "gmail.send.reply", "gmail.draft", "gmail.search"].includes(value.action) ? value.action : null;
  const body = typeof value.body === "string" && value.body.trim() ? value.body.slice(0, 10000) : null;
  if (!stage || !action || (action !== "gmail.search" && !body)) return null;
  const candidate = (item) => item && typeof item.id === "string" && item.id.trim() ? {
    id: item.id.slice(0, 200), threadId: typeof item.threadId === "string" ? item.threadId.slice(0, 200) : null,
    email: typeof item.email === "string" ? item.email.slice(0, 320) : null,
    displayName: typeof item.displayName === "string" ? item.displayName.slice(0, 320) : null,
    subject: typeof item.subject === "string" ? item.subject.slice(0, 500) : null,
    date: typeof item.date === "string" ? item.date.slice(0, 100) : null,
    snippet: typeof item.snippet === "string" ? item.snippet.slice(0, 1000) : null,
  } : null;
  const identity = value.selectedIdentity && typeof value.selectedIdentity.email === "string" ? {
    name: typeof value.selectedIdentity.name === "string" ? value.selectedIdentity.name.slice(0, 320) : null,
    email: value.selectedIdentity.email.slice(0, 320),
  } : null;
  const result = { stage, action, ...(body ? { body } : {}), selectedIdentity: identity };
  for (const key of ["identityCandidates", "conversationCandidates"]) {
    if (Array.isArray(value[key])) result[key] = value[key].map(candidate).filter(Boolean).slice(0, 50);
  }
  const selectedConversation = candidate(value.selectedConversation);
  if (selectedConversation) result.selectedConversation = selectedConversation;
  if (stage === "no_history" && value.selectedIdentity?.email) result.selectedIdentity = identity;
  return result;
};
const createConversationContextService = (model = TemporaryConversation, { ttlMs = DEFAULT_TTL_MS, now = () => new Date() } = {}) => {
  const expiration = () => new Date(now().getTime() + ttlMs);
  const create = async ({ userId, conversationId = crypto.randomUUID() }) => model.create({ conversationId, user: userId, expiresAt: expiration() });
  const getActive = async ({ userId, conversationId }) => model.findOne({ conversationId, user: userId, expiresAt: { $gt: now() } });
  const update = async ({ userId, conversationId, messages, retrievedContext, placeholderMappings, gmailMessageIds, gmailCandidates, pendingGmailReply, trustedTarget, trustedGmailPerson, trustedDraft, pendingAmbiguity, pendingInteraction, calendarEventIds, calendarCandidates, trustedCalendarEvent }) => {
    const updateData = { $set: { expiresAt: expiration() } };
    if (messages !== undefined) updateData.$set.messages = normalizeMessages(messages);
    if (retrievedContext !== undefined) updateData.$set.retrievedContext = retrievedContext;
    if (placeholderMappings !== undefined) updateData.$set.placeholderMappings = placeholderMappings;
    if (gmailMessageIds !== undefined) updateData.$set.gmailMessageIds = normalizeGmailMessageIds(gmailMessageIds);
    if (gmailCandidates !== undefined) updateData.$set.gmailCandidates = normalizeGmailCandidates(gmailCandidates);
    if (pendingGmailReply !== undefined) updateData.$set.pendingGmailReply = normalizePendingGmailReply(pendingGmailReply);
    if (trustedTarget !== undefined) updateData.$set.trustedTarget = normalizeTrustedTarget(trustedTarget);
    if (trustedGmailPerson !== undefined) updateData.$set.trustedGmailPerson = normalizeTrustedGmailPerson(trustedGmailPerson);
    if (trustedDraft !== undefined) updateData.$set.trustedDraft = normalizeTrustedDraft(trustedDraft);
    if (pendingAmbiguity !== undefined) updateData.$set.pendingAmbiguity = normalizePendingAmbiguity(pendingAmbiguity);
    if (pendingInteraction !== undefined) updateData.$set.pendingInteraction = normalizePendingInteraction(pendingInteraction);
    if (calendarEventIds !== undefined) updateData.$set.calendarEventIds = normalizeCalendarEventIds(calendarEventIds);
    if (calendarCandidates !== undefined) updateData.$set.calendarCandidates = normalizeCalendarCandidates(calendarCandidates);
    if (trustedCalendarEvent !== undefined) updateData.$set.trustedCalendarEvent = normalizeTrustedCalendarEvent(trustedCalendarEvent);
    return model.findOneAndUpdate({ conversationId, user: userId, expiresAt: { $gt: now() } }, updateData, { new: true });
  };
  const cleanupExpired = () => model.deleteMany({ expiresAt: { $lte: now() } });
  return { create, getActive, update, cleanupExpired };
};
module.exports = { createConversationContextService, DEFAULT_TTL_MS, normalizeGmailMessageIds, normalizeGmailCandidates, normalizeMessages, normalizePendingGmailReply, normalizeTrustedTarget, normalizeTrustedGmailPerson, normalizeTrustedDraft, normalizePendingAmbiguity, normalizePendingInteraction, normalizeCalendarEventIds, normalizeCalendarCandidates, normalizeTrustedCalendarEvent };
