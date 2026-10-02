const { validateIntent } = require("./intentValidator");
const { splitRecipientTokens } = require("../validation/recipientList");
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

// A short, unambiguous request to check unread mail does not need model
// interpretation. Keep the matcher narrow so it cannot swallow other email
// tasks (drafting, replying, or marking messages read).
const unreadMailSearchRequested = (message) => {
  const source = String(message || "").trim();
  if (!/\b(?:check|find|search|look\s+(?:for|at)|show|list)\b/i.test(source)) return false;
  if (!/\b(?:unread|unred)\b/i.test(source)) return false;
  if (!/\b(?:emails?|messages?|mail)\b/i.test(source)) return false;
  // Only take this shortcut for a plain "show me what's unread" request. If
  // the message also names a date range, sender, or other criteria, that
  // needs the model to translate it into real Gmail query syntax — firing
  // the shortcut here would silently drop that criteria and hand back every
  // unread message instead of the ones actually asked for.
  if (/\b(?:from|about|regarding|subject|last|this|next|today|yesterday|tomorrow|week|weeks|month|months|day|days|hour|hours|between|before|after|since)\b/i.test(source)) return false;
  return true;
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
    if (unreadMailSearchRequested(prompt.userRequest)) {
      return { status: "proposed", provider: providerName, intent: {
        action: "gmail.search",
        parameters: {
          body: null, maxResults: 50, messageId: null, query: "is:unread", recipient: null, subject: null,
          eventId: null, summary: null, description: null, location: null,
          startDateTime: null, endDateTime: null, timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
        },
      }, placeholderMappings: prepared.mappings };
    }
    try { response = await adapter.generateIntent(prompt); }
    catch (error) { return { status: "provider_error", provider: providerName, reason: error.code || "ai_provider_unavailable" }; }
    // Models sometimes write "[EMAIL_1] and [EMAIL_2]" instead of a comma list.
    // Only the separators are normalised; every entry is still validated one by one.
    if (["gmail.send", "gmail.draft"].includes(response?.action) && typeof response?.parameters?.recipient === "string") {
      response.parameters.recipient = response.parameters.recipient.replace(/\s+(?:and|&|plus)\s+/gi, ", ");
    }
    const rawExplicitRecipient = input.explicitRecipientEmail || extractExplicitRecipientEmails(input.originalUserRequest || input.userRequest)[0] || null;
    const explicitRecipientEmail = typeof rawExplicitRecipient === "string" ? rawExplicitRecipient.trim().toLowerCase() : null;
    // Every address the user actually typed this turn, not just the first —
    // a calendar invite can legitimately name more than one attendee.
    const explicitRecipientEmailsList = [...new Set([
      ...(explicitRecipientEmail ? [explicitRecipientEmail] : []),
      ...extractExplicitRecipientEmails(input.originalUserRequest || input.userRequest),
    ])];
    // Follow-ups such as "send this too" / "just another screenshot" carry no
    // address, so the planner reuses the recipient the server already trusts
    // (an address the user typed earlier in this conversation, or a person they
    // selected). That address comes from server state, never from the model or
    // retrieved content, so it is safe to accept for validation. It is kept
    // separate from the explicit list so the diagnostics stay accurate.
    const trustedPersonEmail = typeof prompt.trustedConversationContext?.trustedGmailPerson?.email === "string"
      ? prompt.trustedConversationContext.trustedGmailPerson.email.trim().toLowerCase() : null;
    const validationRecipientEmails = trustedPersonEmail && !explicitRecipientEmailsList.length
      ? [trustedPersonEmail] : explicitRecipientEmailsList;
    // The model may return one recipient or a comma-separated list of
    // placeholders/addresses; resolve each token before comparing.
    const resolvedModelRecipients = splitRecipientTokens(response?.parameters?.recipient)
      .map((token) => (prepared.mappings?.[token]?.value || token).trim().toLowerCase());
    const hashList = (values) => values.map((value) => addressHash(value)).filter(Boolean).join(",") || "none";
    const recipientMatches = explicitRecipientEmailsList.length > 0 && resolvedModelRecipients.length === explicitRecipientEmailsList.length
      && resolvedModelRecipients.every((address) => explicitRecipientEmailsList.includes(address));
    if (["gmail.send", "gmail.draft"].includes(response?.action)) {
      console.info(`[AI DEBUG] explicit recipient extracted=${explicitRecipientEmailsList.length > 0} count=${explicitRecipientEmailsList.length} hash=${hashList(explicitRecipientEmailsList)}`);
      console.info(`[AI DEBUG] AI recipient count=${resolvedModelRecipients.length} hash=${hashList(resolvedModelRecipients)}`);
      console.info(`[AI DEBUG] recipient comparison=${recipientMatches ? "MATCH" : explicitRecipientEmailsList.length ? "MISMATCH" : "NO_EXPLICIT_RECIPIENT"} source=${explicitRecipientEmailsList.length ? "explicit_user_email" : "none"} validation_path=aiGateway.validateIntent`);
    }
    const validation = validateIntent(response, {
      trustedGmailMessageIds: prompt.trustedConversationContext.gmailMessageIds,
      trustedCalendarEventIds: prompt.trustedConversationContext.calendarEventIds,
      recipientPlaceholders: explicitlyRequestedRecipientPlaceholders(prompt.userRequest, prepared.mappings),
      explicitRecipientEmails: validationRecipientEmails,
    });
    const validationDiagnostic = {
      stage: "intent_validation",
      // The provider already parses its structured JSON before returning.
      // Log only bounded shape metadata; parameter values (including body,
      // query, addresses, and IDs) are deliberately omitted.
      rawModelOutputShape: intentShapeForLog(response),
      parsedIntentShape: intentShapeForLog(response),
      validation: { valid: validation.valid, ...(validation.reason ? { reason: validation.reason } : {}) },
      // Only on failure, and only for date fields: the format of the value with
      // every digit masked (e.g. "9999-99-99 99:99"), never the value itself.
      ...(!validation.valid && /^invalid_(startDateTime|endDateTime|timeMin|timeMax)$/.test(validation.reason || "")
        ? { badDateTimePattern: String(response?.parameters?.[validation.reason.slice(8)] ?? "").slice(0, 40).replace(/\d/g, "9") }
        : {}),
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
