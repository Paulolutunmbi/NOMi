const { validateIntent } = require("./intentValidator");
const { buildIntentPrompt } = require("./promptBoundary");
const { prepareAIInput } = require("../privacy/privacyService");
const { explicitlyRequestedRecipientPlaceholders, requiresTargetClarification, unsupportedRequestReason, untrustedRequestedMessageId } = require("./intentSafetyPolicy");

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
    const validation = validateIntent(response, {
      trustedGmailMessageIds: prompt.trustedConversationContext.gmailMessageIds,
      trustedCalendarEventIds: prompt.trustedConversationContext.calendarEventIds,
      recipientPlaceholders: explicitlyRequestedRecipientPlaceholders(prompt.userRequest, prepared.mappings),
    });
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
