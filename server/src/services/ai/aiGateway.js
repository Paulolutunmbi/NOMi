const { validateIntent } = require("./intentValidator");
const { buildIntentPrompt } = require("./promptBoundary");
const { prepareAIInput } = require("../privacy/privacyService");
const { explicitlyRequestedRecipientPlaceholders, extractExplicitRecipientEmails, requiresTargetClarification, unsupportedRequestReason, untrustedRequestedMessageId } = require("./intentSafetyPolicy");
const crypto = require("node:crypto");
const addressHash = (value) => typeof value === "string" && /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)
  ? crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 12) : null;

// Keep diagnostics useful without ever writing model supplied message text,
// retrieved content, identifiers, or credentials to the application log.
const intentShapeForLog = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { receivedType: value === null ? "null" : typeof value };
  const parameters = value.parameters && typeof value.parameters === "object" && !Array.isArray(value.parameters) ? value.parameters : null;
  return {
    receivedType: "object",
    topLevelKeys: Object.keys(value).slice(0, 8),
    action: typeof value.action === "string" && value.action.length <= 64 ? value.action : typeof value.action,
    parameterKeys: parameters ? Object.keys(parameters).slice(0, 24) : [],
    parameterValueTypes: parameters ? Object.fromEntries(Object.entries(parameters).slice(0, 24).map(([key, item]) => [key, item === null ? "null" : Array.isArray(item) ? "array" : typeof item])) : {},
  };
};

const personSearchQuery = (message) => {
  const source = String(message || "").trim();
  if (!/^(?:please\s+)?(?:search|find|locate|look\s+for|look\s+up)\b/i.test(source)) return null;
  const cleaned = source
    .replace(/^(?:please\s+)?(?:search|find|locate|look\s+for|look\s+up)\s+(?:in\s+)?(?:gmail\s+)?(?:for\s+)?/i, "")
    .replace(/^(?:(?:my|the)\s+)?(?:contact|person|user)\s+/i, "")
    .replace(/[’']s\s+(?:email|emails|message|messages|thread)\.?$/i, "")
    .replace(/\s+(?:he|she|they)\s+(?:is|are)\s+(?:a\s+)?(?:contact|person)\b.*$/i, "")
    .trim();
  if (!cleaned || cleaned.length > 80 || /[@{}():]/.test(cleaned)) return null;
  if (/\b(?:inbox|emails?|messages?|calendar|mail|unread|read|last|recent|from|to|after|before)\b/i.test(cleaned)) return null;
  if (!/^[\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]*){0,2}$/iu.test(cleaned)) return null;
  return cleaned;
};

const defaultClarificationIntent = () => ({
  action: "clarification",
  parameters: {
    body: "Who would you like me to send this to?",
    maxResults: null,
    messageId: null,
    query: null,
    recipient: null,
    subject: null,
    eventId: null, summary: null, description: null, location: null,
    startDateTime: null, endDateTime: null, timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
  },
});

const createAIGateway = ({ providerName = process.env.AI_PROVIDER, adapters = {} } = {}) => ({
  async generateIntent(input) {
    const adapter = providerName && adapters[providerName];
    const prepared = input.safeInput ? { payload: input.safeInput, mappings: input.placeholderMappings || {} } : prepareAIInput(input);
    let response;
    const prompt = buildIntentPrompt({ ...prepared.payload, trustedConversationContext: input.trustedConversationContext || prepared.payload.trustedConversationContext });
    const unsupportedReason = unsupportedRequestReason(prompt.userRequest);
    if (unsupportedReason) return { status: "invalid", provider: providerName, reason: unsupportedReason };
    if (untrustedRequestedMessageId(prompt.userRequest, prompt.trustedConversationContext.gmailMessageIds)) {
      return { status: "invalid", provider: providerName, reason: "untrusted_or_unknown_message_id" };
    }
    if (!adapter || typeof adapter.generateIntent !== "function") return { status: "unavailable", provider: providerName || null, reason: "ai_provider_not_configured" };
    // Person lookup is a first-class Gmail intent. Resolve its small, explicit
    // language pattern before the model so plain requests such as "search paul"
    // cannot become an invalid planner proposal or a generic clarification.
    const requestedPerson = personSearchQuery(prompt.userRequest);
    if (requestedPerson) {
      return { status: "proposed", provider: providerName, intent: {
        action: "gmail.search",
        parameters: {
          body: null, maxResults: 50, messageId: null,
          query: `{from:${requestedPerson.toLowerCase()} to:${requestedPerson.toLowerCase()}}`, recipient: null, subject: null,
          eventId: null, summary: null, description: null, location: null,
          startDateTime: null, endDateTime: null, timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
        },
      }, placeholderMappings: prepared.mappings };
    }
    try { response = await adapter.generateIntent(prompt); }
    catch (error) { return { status: "provider_error", provider: providerName, reason: error.code || "ai_provider_unavailable" }; }
    const rawExplicitRecipient = input.explicitRecipientEmail || extractExplicitRecipientEmails(input.originalUserRequest || input.userRequest)[0] || null;
    const explicitRecipientEmail = typeof rawExplicitRecipient === "string" ? rawExplicitRecipient.trim().toLowerCase() : null;
    // Every address the user actually typed this turn, not just the first —
    // a calendar invite can legitimately name more than one attendee.
    const explicitRecipientEmailsList = [...new Set([
      ...(explicitRecipientEmail ? [explicitRecipientEmail] : []),
      ...extractExplicitRecipientEmails(input.originalUserRequest || input.userRequest),
    ])];
    const modelRecipient = response?.parameters?.recipient;
    const resolvedModelRecipient = prepared.mappings?.[modelRecipient]?.value || modelRecipient;
    const recipientMatches = Boolean(explicitRecipientEmail && typeof resolvedModelRecipient === "string" && resolvedModelRecipient.trim().toLowerCase() === explicitRecipientEmail);
    if (["gmail.send", "gmail.draft"].includes(response?.action)) {
      console.info(`[AI DEBUG] explicit recipient extracted=${Boolean(explicitRecipientEmail)} hash=${addressHash(explicitRecipientEmail) || "none"}`);
      console.info(`[AI DEBUG] AI recipient hash=${addressHash(resolvedModelRecipient) || "none"}`);
      console.info(`[AI DEBUG] recipient comparison=${recipientMatches ? "MATCH" : explicitRecipientEmail ? "MISMATCH" : "NO_EXPLICIT_RECIPIENT"} source=${explicitRecipientEmail ? "explicit_user_email" : "none"} validation_path=aiGateway.validateIntent`);
    }
    const validation = validateIntent(response, {
      trustedGmailMessageIds: prompt.trustedConversationContext.gmailMessageIds,
      trustedCalendarEventIds: prompt.trustedConversationContext.calendarEventIds,
      recipientPlaceholders: explicitlyRequestedRecipientPlaceholders(prompt.userRequest, prepared.mappings),
      explicitRecipientEmails: explicitRecipientEmailsList,
    });
    const validationDiagnostic = {
      stage: "intent_validation",
      // The provider already parses its structured JSON before returning.
      // Log only bounded shape metadata; parameter values (including body,
      // query, addresses, and IDs) are deliberately omitted.
      rawModelOutputShape: intentShapeForLog(response),
      parsedIntentShape: intentShapeForLog(response),
      validation: { valid: validation.valid, ...(validation.reason ? { reason: validation.reason } : {}) },
    };
    const diagnostic = `[AI DEBUG] intent validation ${validation.valid ? "passed" : "failed"} ${JSON.stringify(validationDiagnostic)}`;
    (validation.valid ? console.info : console.warn)(diagnostic);
    if (validation.valid) {
      if (validation.intent.action === "gmail.search" && requiresTargetClarification(prompt.userRequest, prompt.trustedConversationContext.gmailMessageIds)) {
        return { status: "proposed", provider: providerName, intent: defaultClarificationIntent(), placeholderMappings: prepared.mappings };
      }
      return { status: "proposed", provider: providerName, intent: validation.intent, placeholderMappings: prepared.mappings };
    }
    if (requiresTargetClarification(prompt.userRequest, prompt.trustedConversationContext.gmailMessageIds)
      && !["untrusted_recipient_placeholder", "untrusted_recipient_email"].includes(validation.reason)) {
      return { status: "proposed", provider: providerName, intent: defaultClarificationIntent(), placeholderMappings: prepared.mappings };
    }
    return { status: "invalid", provider: providerName, reason: validation.reason };
  },
});

// These are contracts, deliberately not SDK-backed providers. Future adapters implement generateIntent(prompt).
const supportedProviderNames = ["gemini", "groq"];
module.exports = { createAIGateway, supportedProviderNames, defaultClarificationIntent };
