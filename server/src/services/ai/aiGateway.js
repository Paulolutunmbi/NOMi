const { validateIntent } = require("./intentValidator");
const { buildIntentPrompt } = require("./promptBoundary");
const { prepareAIInput } = require("../privacy/privacyService");

const createAIGateway = ({ providerName = process.env.AI_PROVIDER, adapters = {} } = {}) => ({
  async generateIntent(input) {
    const adapter = providerName && adapters[providerName];
    if (!adapter || typeof adapter.generateIntent !== "function") return { status: "unavailable", provider: providerName || null, reason: "ai_provider_not_configured" };
    const prepared = input.safeInput ? { payload: input.safeInput, mappings: {} } : prepareAIInput(input);
    let response;
    try { response = await adapter.generateIntent(buildIntentPrompt(prepared.payload)); }
    catch (error) { return { status: "provider_error", provider: providerName, reason: error.code || "ai_provider_unavailable" }; }
    const validation = validateIntent(response);
    return validation.valid
      ? { status: "proposed", provider: providerName, intent: validation.intent, placeholderMappings: prepared.mappings }
      : { status: "invalid", provider: providerName, reason: validation.reason };
  },
});

// These are contracts, deliberately not SDK-backed providers. Future adapters implement generateIntent(prompt).
const supportedProviderNames = ["gemini", "groq"];
module.exports = { createAIGateway, supportedProviderNames };
