const MESSAGE_ID_PATTERN = /\b(?:gmail\s+)?message\s+(?:id\s+|#\s*)?([0-9a-fA-F]{6,64}|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,64})\b/i;
const PRONOUN_TARGET = /\b(?:him|her|them|that\s+person|this\s+person|the\s+sender)\b/i;
const EXPLICIT_SEARCH_OR_READ = /\b(?:find|search|look\s*(?:for|up)|locate|check|scan|read|query|fetch)\b/i;
const COMPOSE_OR_REPLY = /\b(?:craft|compose|draft|send|write|tell|reply|respond|response|message)\b/i;

const extractExplicitRecipientEmail = (message) => extractExplicitRecipientEmails(message)[0] || null;

// All distinct addresses the user literally typed in their current message —
// not just the first. Needed for calendar invites, which (unlike a Gmail
// send) can legitimately name more than one address in a single request.
const extractExplicitRecipientEmails = (message) => {
  const normalized = String(message || "").replace(/\[[^\]]+\]\(mailto:([^)]+)\)/ig, "$1");
  const matches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  return [...new Set(matches.map((address) => address.toLowerCase()))];
};

const unsupportedRequestReason = (userRequest) => {
  if (typeof userRequest !== "string") return null;
  if (/\b(delete|trash|remove|erase)\b[^.!?]{0,120}\b(emails?|inbox|messages?)\b/i.test(userRequest)) return "unsupported_destructive_request";
  if (/\b(grant|give|change|modify|set)\b[^.!?]{0,120}\b(permission|permissions|access|privilege|privileges)\b/i.test(userRequest)
    || /\bpermission(?:s)?\b[^.!?]{0,120}\b(send|email)/i.test(userRequest)) return "unsupported_permission_request";
  if (/\b(show|reveal|display|give|provide|access|retrieve|extract)\b[^.!?]{0,120}\b(oauth|api\s*key|credentials?|tokens?|secrets?|passwords?)\b/i.test(userRequest)) return "unsupported_credential_request";
  if (/\b(execute|run)\b[^.!?]{0,120}\b(commands?|shell|terminal|powershell|bash)\b/i.test(userRequest)) return "unsupported_command_request";
  return null;
};

const hasEmbeddedInstruction = (userRequest) => typeof userRequest === "string"
  && /\b(ignore|disregard|override)\b[^.!?]{0,80}\b(previous|prior|system|instructions?|policy)\b/i.test(userRequest);

const isExplicitSearchOrReadRequest = (userRequest) => typeof userRequest === "string"
  && EXPLICIT_SEARCH_OR_READ.test(userRequest);

const isPronounOrMissingTargetRequest = (userRequest) => typeof userRequest === "string"
  && !hasEmbeddedInstruction(userRequest)
  && (PRONOUN_TARGET.test(userRequest) || COMPOSE_OR_REPLY.test(userRequest));
const hasNamedReplyTarget = (userRequest) => typeof userRequest === "string"
  && /\b(?:reply|respond)\s+to\s+[A-Za-z][A-Za-z .'-]{0,80}(?:\s+(?:and|saying|telling|that)|[.!?,]|$)/i.test(userRequest);

const requiresTargetClarification = (userRequest, trustedGmailMessageIds = []) => {
  if (typeof userRequest !== "string" || hasEmbeddedInstruction(userRequest)) return false;
  if (Array.isArray(trustedGmailMessageIds) && trustedGmailMessageIds.length > 0) return false;
  if (hasNamedReplyTarget(userRequest)) return false;
  if (isExplicitSearchOrReadRequest(userRequest)) return false;
  return isPronounOrMissingTargetRequest(userRequest);
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const explicitlyRequestedRecipientPlaceholders = (userRequest, mappings = {}) => {
  if (hasEmbeddedInstruction(userRequest)) return [];
  const placeholders = Object.entries(mappings)
    .filter(([, value]) => value.type === "EMAIL")
    .map(([placeholder]) => placeholder);
  // Accept conversational lead-ins ("Good morning, send a mail to …") and
  // mailto markdown. Trust still comes only from an address in this user turn.
  const plainRequest = String(userRequest || "").replace(/\[([^\]]+)\]\(mailto:([^)]+)\)/ig, (_link, label, address) => {
    const value = /\[EMAIL_\d+\]/i.test(address) ? address : /\[EMAIL_\d+\]/i.test(label) ? label : address;
    return /^\[EMAIL_\d+\]$/i.test(value) ? value : `[${value}]`;
  });
  const directlyRequested = placeholders.filter((placeholder) => {
    const escaped = escapeRegExp(placeholder);
    // Calendar invites are commonly phrased as "meeting/call/event *with*
    // someone" rather than "send/email *to* someone" — that preposition, and
    // the scheduling verbs that pair with it, need to count as an explicit
    // request too, or a literally-typed attendee address gets rejected as
    // untrusted just because of how the sentence is worded.
    return new RegExp(`(?:\\b(?:send|draft|write|compose|mail|email|add|invite|include|create|schedule|set\\s*up|book|meet)\\b[^.!?]{0,220}\\b(?:to|for|in|with)\\s*${escaped}|\\b(?:email|mail)\\s+${escaped}|\\b(?:add|invite|include|cc)\\s+(?:(?:\\[[^\\]]+\\]|and|also|,|&)\\s*)*${escaped})`, "i").test(plainRequest);
  });
  // A list such as "send a mail to A, and B" only puts the *first* address
  // directly after "to". Any further address the user typed in the same list
  // (joined by a comma, "and", "&", "plus" or "also") is part of the same
  // explicit request. Trust still comes only from the user's own text, and it
  // can only extend from an address that was already directly requested.
  const requested = new Set(directlyRequested);
  let grew = true;
  while (grew) {
    grew = false;
    for (const placeholder of placeholders) {
      if (requested.has(placeholder)) continue;
      const escaped = escapeRegExp(placeholder);
      const continuesList = [...requested].some((anchor) => new RegExp(`${escapeRegExp(anchor)}(?:\\s*(?:[,;&]|\\band\\b|\\bplus\\b|\\balso\\b))+\\s*${escaped}`, "i").test(plainRequest));
      if (continuesList) { requested.add(placeholder); grew = true; }
    }
  }
  return placeholders.filter((placeholder) => requested.has(placeholder));
};

const untrustedRequestedMessageId = (userRequest, trustedGmailMessageIds = []) => {
  if (typeof userRequest !== "string") return null;
  const match = userRequest.match(MESSAGE_ID_PATTERN);
  return match && !trustedGmailMessageIds.includes(match[1]) ? match[1] : null;
};

module.exports = {
  MESSAGE_ID_PATTERN,
  PRONOUN_TARGET,
  extractExplicitRecipientEmail,
  extractExplicitRecipientEmails,
  explicitlyRequestedRecipientPlaceholders,
  hasEmbeddedInstruction,
  isExplicitSearchOrReadRequest,
  isPronounOrMissingTargetRequest,
  hasNamedReplyTarget,
  requiresTargetClarification,
  unsupportedRequestReason,
  untrustedRequestedMessageId,
};
