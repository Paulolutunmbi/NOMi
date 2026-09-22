const ACTIONS = {
  "gmail.read": { required: ["messageId"], allowed: ["messageId"] },
  "gmail.search": { required: ["query"], allowed: ["query", "maxResults"] },
  "gmail.draft": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  "gmail.send": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  "gmail.draft.reply": { required: ["messageId", "body"], allowed: ["messageId", "body"] },
  "gmail.send.reply": { required: ["messageId", "body"], allowed: ["messageId", "body"] },
  "clarification": { required: ["body"], allowed: ["body"] },
  // Compound search-then-reply intents. The model supplies query + body only.
  // messageId, recipient, and subject must remain null — the orchestrator
  // resolves the trusted target server-side after executing the search.
  "gmail.search_then_reply": { required: ["query", "body"], allowed: ["query", "body", "maxResults"] },
  "gmail.search_then_draft_reply": { required: ["query", "body"], allowed: ["query", "body", "maxResults"] },
  "gmail.search_then_send_reply": { required: ["query", "body"], allowed: ["query", "body", "maxResults"] },
};
const SCHEMA_PARAMETERS = ["body", "maxResults", "messageId", "query", "recipient", "subject"];
const SAFE_STRING = (value, max = 10000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const EMAIL_PLACEHOLDER = /^\[EMAIL_\d+\]$/;
// These are opaque model-facing markers, not aliases for an address. They
// become an address only at the authenticated execution boundary.
const SELF_RECIPIENT_MARKERS = new Set([
  "myself",
  "me",
  "my own email",
  "my own email address",
  "my email",
  "my email address",
  "self",
]);

const isSelfRecipientMarker = (value) => typeof value === "string"
  && SELF_RECIPIENT_MARKERS.has(value.trim().toLowerCase());

const validateIntent = (intent, { trustedGmailMessageIds = [], recipientPlaceholders = [] } = {}) => {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return { valid: false, reason: "intent_must_be_an_object" };
  if (Object.keys(intent).some((key) => !["action", "parameters"].includes(key))) return { valid: false, reason: "unexpected_intent_field" };
  if (!ACTIONS[intent.action]) return { valid: false, reason: "unsupported_action" };
  if (!intent.parameters || typeof intent.parameters !== "object" || Array.isArray(intent.parameters)) return { valid: false, reason: "parameters_must_be_an_object" };
  const rule = ACTIONS[intent.action];
  const keys = Object.keys(intent.parameters);
  if (keys.length !== SCHEMA_PARAMETERS.length || SCHEMA_PARAMETERS.some((key) => !Object.hasOwn(intent.parameters, key))) return { valid: false, reason: "incomplete_provider_output" };
  if (keys.some((key) => !SCHEMA_PARAMETERS.includes(key))) return { valid: false, reason: "unexpected_parameter" };
  if (keys.some((key) => intent.parameters[key] !== null && !rule.allowed.includes(key))) return { valid: false, reason: "unexpected_parameter" };
  if (rule.required.some((key) => !SAFE_STRING(intent.parameters[key]))) return { valid: false, reason: "missing_or_invalid_parameter" };
  if (intent.parameters.maxResults !== undefined && intent.parameters.maxResults !== null && (!Number.isInteger(intent.parameters.maxResults) || intent.parameters.maxResults < 1 || intent.parameters.maxResults > 50)) return { valid: false, reason: "invalid_max_results" };
  if (["gmail.read", "gmail.draft.reply", "gmail.send.reply"].includes(intent.action)
    && !trustedGmailMessageIds.includes(intent.parameters.messageId)) return { valid: false, reason: "untrusted_or_unknown_message_id" };
  if (["gmail.draft", "gmail.send"].includes(intent.action)) {
    const { recipient } = intent.parameters;
    // A literal address is valid only if privacy protection preserved an
    // address that the user explicitly supplied. Any other string must be a
    // small, explicit self-recipient marker; names await identity resolution.
    if (isSelfRecipientMarker(recipient)) {
      // Accepted without resolving it or exposing the authenticated address.
    } else if (EMAIL_PLACEHOLDER.test(recipient)) {
      if (!recipientPlaceholders.includes(recipient)) return { valid: false, reason: "untrusted_recipient_placeholder" };
    } else if (EMAIL.test(recipient)) {
      return { valid: false, reason: "untrusted_recipient_email" };
    } else {
      return { valid: false, reason: "unresolved_recipient" };
    }
  }
  return { valid: true, intent: { action: intent.action, parameters: { ...intent.parameters } } };
};

module.exports = { ACTIONS, SELF_RECIPIENT_MARKERS, isSelfRecipientMarker, validateIntent };
