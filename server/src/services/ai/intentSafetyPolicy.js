const MESSAGE_ID_REQUEST = /\b(?:gmail\s+)?message\s+([A-Za-z0-9_-]{6,})\b/i;

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
  const match = typeof userRequest === "string" && userRequest.match(MESSAGE_ID_REQUEST);
  return match && !trustedGmailMessageIds.includes(match[1]) ? match[1] : null;
};

module.exports = { explicitlyRequestedRecipientPlaceholders, hasEmbeddedInstruction, unsupportedRequestReason, untrustedRequestedMessageId };
