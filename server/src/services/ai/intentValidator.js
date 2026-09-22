const ACTIONS = {
  "gmail.read": { required: ["messageId"], allowed: ["messageId"] },
  "gmail.search": { required: ["query"], allowed: ["query", "maxResults"] },
  "gmail.draft": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  "gmail.send": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  "gmail.draft.reply": { required: ["messageId", "body"], allowed: ["messageId", "body", "subject"] },
  "gmail.send.reply": { required: ["messageId", "body"], allowed: ["messageId", "body", "subject"] },
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
const CONTROL_CHARS = /[\x00-\x1F\x7F]/;
const SECRET_KEYS = /token|credential|secret|authorization|api.?key|password|bearer/i;
// Patterns that look like Gmail / provider IDs: long base64url-ish strings or
// hex blobs that could be a messageId, threadId, or draftId injected by the model.
const PROVIDER_ID_LOOKALIKE = /(?:^|[\s<>])(?:[A-Za-z0-9_-]{16,}|[0-9a-fA-F]{12,})(?:$|[\s<>])/;
const MAX_SUBJECT_LENGTH = 500;
const MIN_SUBJECT_LENGTH = 1;

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

const REPLY_ACTIONS = new Set(["gmail.draft.reply", "gmail.send.reply"]);

const isSelfRecipientMarker = (value) => typeof value === "string"
  && SELF_RECIPIENT_MARKERS.has(value.trim().toLowerCase());

const validateSubject = (value) => {
  if (value === null || value === undefined) return { valid: true };
  if (typeof value !== "string") return { valid: false, reason: "subject_must_be_a_string" };
  const trimmed = value.trim();
  if (trimmed.length < MIN_SUBJECT_LENGTH) return { valid: false, reason: "subject_too_short" };
  if (trimmed.length > MAX_SUBJECT_LENGTH) return { valid: false, reason: "subject_too_long" };
  if (CONTROL_CHARS.test(value)) return { valid: false, reason: "subject_contains_control_characters" };
  if (SECRET_KEYS.test(value)) return { valid: false, reason: "subject_may_contain_credentials" };
  if (PROVIDER_ID_LOOKALIKE.test(value)) return { valid: false, reason: "subject_may_contain_provider_ids" };
  return { valid: true };
};

const generateSubjectFromBody = (body) => {
  const cleaned = String(body || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Message";
  const sentence = cleaned.split(/[.!?\n]/)[0] || cleaned;
  const truncated = sentence.length > 80 ? sentence.slice(0, 77).trimEnd() + "..." : sentence;
  return truncated || "Message";
};

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
    const { recipient, subject } = intent.parameters;
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
    // Subject is optional from the model, but if provided it must be safe.
    const subjectCheck = validateSubject(subject);
    if (!subjectCheck.valid) return { valid: false, reason: subjectCheck.reason };
  }
  // Replies NEVER accept a model-supplied subject: thread/subject come from the trusted Gmail target.
  if (REPLY_ACTIONS.has(intent.action) && intent.parameters.subject !== null) {
    return { valid: false, reason: "reply_subject_must_be_null" };
  }
  return { valid: true, intent: { action: intent.action, parameters: { ...intent.parameters } } };
};

module.exports = { ACTIONS, REPLY_ACTIONS, SELF_RECIPIENT_MARKERS, isSelfRecipientMarker, validateIntent, validateSubject, generateSubjectFromBody };
