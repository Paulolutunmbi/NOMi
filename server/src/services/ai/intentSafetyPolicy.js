const MESSAGE_ID_PATTERN = /\b(?:gmail\s+)?message\s+(?:id\s+|#\s*)?([0-9a-fA-F]{6,64}|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{6,64})\b/i;
const PRONOUN_TARGET = /\b(?:him|her|them|that\s+person|this\s+person|the\s+sender)\b/i;
const EXPLICIT_SEARCH_OR_READ = /\b(?:find|search|look\s*(?:for|up)|locate|check|scan|read|query|fetch)\b/i;
const COMPOSE_OR_REPLY = /\b(?:craft|compose|draft|send|write|tell|reply|respond|response|message)\b/i;

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

const explicitlyRequestedRecipientPlaceholders = (userRequest, mappings = {}) => {
  if (hasEmbeddedInstruction(userRequest)) return [];
  const placeholders = Object.entries(mappings)
    .filter(([, value]) => value.type === "EMAIL")
    .map(([placeholder]) => placeholder);
  return placeholders.filter((placeholder) => {
    const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^\\s*(?:(?:please|can you|could you)\\s+)?(?:send|draft|write|compose)\\b[^.!?]{0,160}\\b(?:to|for)\\s*${escaped}`, "i").test(userRequest);
  });
};

const untrustedRequestedMessageId = (userRequest, trustedGmailMessageIds = []) => {
  if (typeof userRequest !== "string") return null;
  const match = userRequest.match(MESSAGE_ID_PATTERN);
  return match && !trustedGmailMessageIds.includes(match[1]) ? match[1] : null;
};

module.exports = {
  MESSAGE_ID_PATTERN,
  PRONOUN_TARGET,
  explicitlyRequestedRecipientPlaceholders,
  hasEmbeddedInstruction,
  isExplicitSearchOrReadRequest,
  isPronounOrMissingTargetRequest,
  hasNamedReplyTarget,
  requiresTargetClarification,
  unsupportedRequestReason,
  untrustedRequestedMessageId,
};
