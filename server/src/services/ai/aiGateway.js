const { validateIntent } = require("./intentValidator");
const { buildIntentPrompt } = require("./promptBoundary");
const { prepareAIInput } = require("../privacy/privacyService");
const { explicitlyRequestedRecipientPlaceholders, requiresTargetClarification, unsupportedRequestReason, untrustedRequestedMessageId } = require("./intentSafetyPolicy");

const defaultClarificationIntent = () => ({
  action: "clarification",
  parameters: {
    body: "Who would you like me to send this to?",
    maxResults: null,
    messageId: null,
    query: null,
    recipient: null,
    subject: null,
  },
});

const createAIGateway = ({ providerName = process.env.AI_PROVIDER, adapters = {} } = {}) => ({
  async generateIntent(input) {
    const adapter = providerName && adapters[providerName];
    if (!adapter || typeof adapter.generateIntent !== "function") return { status: "unavailable", provider: providerName || null, reason: "ai_provider_not_configured" };
    const prepared = input.safeInput ? { payload: input.safeInput, mappings: input.placeholderMappings || {} } : prepareAIInput(input);
    let response;
    const prompt = buildIntentPrompt({ ...prepared.payload, trustedConversationContext: input.trustedConversationContext || prepared.payload.trustedConversationContext });
    const unsupportedReason = unsupportedRequestReason(prompt.userRequest);
    if (unsupportedReason) return { status: "invalid", provider: providerName, reason: unsupportedReason };
    if (untrustedRequestedMessageId(prompt.userRequest, prompt.trustedConversationContext.gmailMessageIds)) {
      return { status: "invalid", provider: providerName, reason: "untrusted_or_unknown_message_id" };
    }
    try { response = await adapter.generateIntent(prompt); }
    catch (error) { return { status: "provider_error", provider: providerName, reason: error.code || "ai_provider_unavailable" }; }
    const validation = validateIntent(response, {
      trustedGmailMessageIds: prompt.trustedConversationContext.gmailMessageIds,
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
