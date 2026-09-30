const { MAX_RECIPIENTS, splitRecipientTokens } = require("../validation/recipientList");

const ACTIONS = {
  "gmail.read": { required: ["messageId"], allowed: ["messageId"] },
  "gmail.search": { required: ["query"], allowed: ["query", "maxResults"] },
  "gmail.draft": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  "gmail.send": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  // Marks Gmail messages as read. The model may only supply an optional
  // count (maxResults, "mark the last 3 as read"); the server acts only on
  // message IDs it trusts (already in this conversation, or fetched by its
  // own unread search), never on IDs the model invents.
  "gmail.markRead": { required: [], allowed: ["maxResults"] },
  "gmail.draft.reply": { required: ["messageId", "body"], allowed: ["messageId", "body", "subject"] },
  "gmail.send.reply": { required: ["messageId", "body"], allowed: ["messageId", "body", "subject"] },
  // Content-only edit of the currently trusted draft ("make it more casual").
  // The server supplies the trusted draftId/thread/recipient from
  // conversation state; the model may only propose a revised body.
  "gmail.draft.edit": { required: ["body"], allowed: ["body"] },
  "clarification": { required: ["body"], allowed: ["body"] },
  // Plain conversational reply: greetings, "what can you do", small talk,
  // or anything else that isn't a Gmail/Calendar request. Never carries a
  // recipient, messageId, eventId, or any other privileged parameter.
  "chat.respond": { required: ["body"], allowed: ["body"] },
  // Compound search-then-reply intents. The model supplies query + body only.
  // messageId, recipient, and subject must remain null — the orchestrator
  // resolves the trusted target server-side after executing the search.
  "gmail.search_then_reply": { required: ["query", "body"], allowed: ["query", "body", "maxResults"] },
  "gmail.search_then_draft_reply": { required: ["query", "body"], allowed: ["query", "body", "maxResults"] },
  "gmail.search_then_send_reply": { required: ["query", "body"], allowed: ["query", "body", "maxResults"] },
  // Calendar actions follow the same trust boundary as Gmail: eventId is
  // never accepted unless it is already a server-trusted ID from a prior
  // calendar.search/read in this conversation (see trustedCalendarEventIds).
  "calendar.search": { required: [], allowed: ["query", "timeMin", "timeMax", "maxResults"] },
  "calendar.read": { required: ["eventId"], allowed: ["eventId"] },
  "calendar.freebusy": { required: ["timeMin", "timeMax"], allowed: ["timeMin", "timeMax"] },
  // endDateTime is intentionally not required: when the user never states an
  // end time or duration, the orchestrator defaults it to one hour after
  // startDateTime rather than looping the user through an unanswerable
  // clarification about a detail they never intended to specify.
  "calendar.create": { required: ["summary", "startDateTime"], allowed: ["summary", "description", "location", "startDateTime", "endDateTime", "timeZone", "attendees", "addMeet"] },
  "calendar.update": { required: ["eventId"], allowed: ["eventId", "summary", "description", "location", "startDateTime", "endDateTime", "timeZone", "attendees", "addMeet"] },
  "calendar.delete": { required: ["eventId"], allowed: ["eventId"] },
};
const SCHEMA_PARAMETERS = [
  "body", "maxResults", "messageId", "query", "recipient", "subject",
  "eventId", "summary", "description", "location", "startDateTime", "endDateTime", "timeZone", "attendees", "timeMin", "timeMax", "addMeet",
];
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
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const CALENDAR_EVENT_ACTIONS = new Set(["calendar.read", "calendar.update", "calendar.delete"]);

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

const validateIntent = (intent, { trustedGmailMessageIds = [], trustedCalendarEventIds = [], recipientPlaceholders = [], explicitRecipientEmails = [] } = {}) => {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return { valid: false, reason: "intent_must_be_an_object" };
  if (Object.keys(intent).some((key) => !["action", "parameters"].includes(key))) return { valid: false, reason: "unexpected_intent_field" };
  if (!ACTIONS[intent.action]) return { valid: false, reason: "unsupported_action" };
  if (!intent.parameters || typeof intent.parameters !== "object" || Array.isArray(intent.parameters)) return { valid: false, reason: "parameters_must_be_an_object" };
  const rule = ACTIONS[intent.action];
  const keys = Object.keys(intent.parameters);
  // Ensure all expected schema parameters are present (may be null)
  if (keys.length !== SCHEMA_PARAMETERS.length || SCHEMA_PARAMETERS.some((key) => !Object.hasOwn(intent.parameters, key))) return { valid: false, reason: "incomplete_provider_output" };
  // Ensure no unexpected parameters are included
  if (keys.some((key) => !SCHEMA_PARAMETERS.includes(key))) return { valid: false, reason: "unexpected_parameter" };
  if (keys.some((key) => intent.parameters[key] !== null && !rule.allowed.includes(key))) return { valid: false, reason: "unexpected_parameter" };
  if (rule.required.some((key) => !SAFE_STRING(intent.parameters[key]))) return { valid: false, reason: "missing_or_invalid_parameter" };
  if (intent.parameters.maxResults !== undefined && intent.parameters.maxResults !== null && (!Number.isInteger(intent.parameters.maxResults) || intent.parameters.maxResults < 1 || intent.parameters.maxResults > 50)) return { valid: false, reason: "invalid_max_results" };
  if (["gmail.read", "gmail.draft.reply", "gmail.send.reply"].includes(intent.action)
    && !trustedGmailMessageIds.includes(intent.parameters.messageId)) return { valid: false, reason: "untrusted_or_unknown_message_id" };
  if (["gmail.draft", "gmail.send"].includes(intent.action)) {
    const { recipient, subject } = intent.parameters;
    // recipient may be one address or a comma/semicolon separated list (same
    // convention as calendar attendees). Every token is held to the exact same
    // trust rule a single recipient always had: a literal address is valid only
    // if privacy protection preserved an address the user explicitly supplied.
    // Any other string must be a small, explicit self-recipient marker; names
    // await identity resolution.
    const tokens = splitRecipientTokens(recipient);
    if (!tokens.length) return { valid: false, reason: "unresolved_recipient" };
    if (tokens.length > MAX_RECIPIENTS) return { valid: false, reason: "too_many_recipients" };
    for (const token of tokens) {
      if (isSelfRecipientMarker(token)) {
        // Accepted without resolving it or exposing the authenticated address.
      } else if (EMAIL_PLACEHOLDER.test(token)) {
        if (!recipientPlaceholders.includes(token)) return { valid: false, reason: "untrusted_recipient_placeholder" };
      } else if (EMAIL.test(token) && explicitRecipientEmails.includes(token.toLowerCase())) {
        // The planner may use exactly the addresses explicitly supplied this turn.
      } else if (EMAIL.test(token)) {
        return { valid: false, reason: explicitRecipientEmails.length ? "explicit_recipient_mismatch" : "untrusted_recipient_email" };
      } else {
        return { valid: false, reason: "unresolved_recipient" };
      }
    }
    // Subject is optional from the model, but if provided it must be safe.
    const subjectCheck = validateSubject(subject);
    if (!subjectCheck.valid) return { valid: false, reason: subjectCheck.reason };
  }
  // Replies NEVER accept a model-supplied subject: thread/subject come from the trusted Gmail target.
  if (REPLY_ACTIONS.has(intent.action) && intent.parameters.subject !== null) {
    return { valid: false, reason: "reply_subject_must_be_null" };
  }
  if (CALENDAR_EVENT_ACTIONS.has(intent.action) && !trustedCalendarEventIds.includes(intent.parameters.eventId)) {
    return { valid: false, reason: "untrusted_or_unknown_event_id" };
  }
  if (["calendar.search", "calendar.freebusy", "calendar.create", "calendar.update"].includes(intent.action)) {
    for (const key of ["startDateTime", "endDateTime", "timeMin", "timeMax"]) {
      const value = intent.parameters[key];
      if (value !== null && value !== undefined && !ISO_DATETIME.test(String(value).trim())) return { valid: false, reason: `invalid_${key}` };
    }
  }
  if (["calendar.create", "calendar.update"].includes(intent.action) && intent.parameters.attendees !== null) {
    const { attendees } = intent.parameters;
    if (typeof attendees !== "string" || !attendees.trim()) return { valid: false, reason: "invalid_attendees" };
    const tokens = attendees.split(/[,;]/).map((token) => token.trim()).filter(Boolean);
    if (!tokens.length) return { valid: false, reason: "invalid_attendees" };
    for (const token of tokens) {
      // Same trust rule as Gmail's recipient field: a literal address is only
      // valid if it's an explicit privacy placeholder the user actually typed,
      // it exactly matches an address the user typed in this turn's message
      // (however they phrased the request around it), or it's the self
      // marker. The model may never invent an attendee address.
      if (isSelfRecipientMarker(token)) continue;
      if (EMAIL_PLACEHOLDER.test(token)) { if (!recipientPlaceholders.includes(token)) return { valid: false, reason: "untrusted_recipient_placeholder" }; continue; }
      if (EMAIL.test(token) && explicitRecipientEmails.includes(token.toLowerCase())) continue;
      if (EMAIL.test(token)) return { valid: false, reason: "untrusted_recipient_email" };
      return { valid: false, reason: "unresolved_recipient" };
    }
  }
  if (["calendar.create", "calendar.update"].includes(intent.action) && intent.parameters.addMeet !== null && typeof intent.parameters.addMeet !== "boolean") {
    return { valid: false, reason: "invalid_add_meet" };
  }
  return { valid: true, intent: { action: intent.action, parameters: { ...intent.parameters } } };
};

module.exports = { ACTIONS, REPLY_ACTIONS, CALENDAR_EVENT_ACTIONS, SELF_RECIPIENT_MARKERS, isSelfRecipientMarker, validateIntent, validateSubject, generateSubjectFromBody };
