const Groq = require("groq-sdk");
const { getAIConfig, validateAIConfig } = require("../../config/ai");

const INTENT_SCHEMA = {
  name: "nomi_gmail_intent",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [
          "gmail.read", "gmail.search", "gmail.draft", "gmail.send", "gmail.draft.reply", "gmail.send.reply", "gmail.draft.edit", "gmail.markRead", "clarification", "chat.respond",
          "gmail.search_then_reply", "gmail.search_then_draft_reply", "gmail.search_then_send_reply",
          "calendar.search", "calendar.read", "calendar.freebusy", "calendar.create", "calendar.update", "calendar.delete",
        ],
      },
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          messageId: { type: ["string", "null"] }, query: { type: ["string", "null"] }, maxResults: { type: ["integer", "null"] },
          recipient: { type: ["string", "null"] }, subject: { type: ["string", "null"] }, body: { type: ["string", "null"] },
          eventId: { type: ["string", "null"] }, summary: { type: ["string", "null"] }, description: { type: ["string", "null"] },
          location: { type: ["string", "null"] }, startDateTime: { type: ["string", "null"] }, endDateTime: { type: ["string", "null"] },
          timeZone: { type: ["string", "null"] }, attendees: { type: ["string", "null"] }, timeMin: { type: ["string", "null"] },
          timeMax: { type: ["string", "null"] }, addMeet: { type: ["boolean", "null"] },
        },
        required: [
          "body", "maxResults", "messageId", "query", "recipient", "subject",
          "eventId", "summary", "description", "location", "startDateTime", "endDateTime", "timeZone", "attendees", "timeMin", "timeMax", "addMeet",
        ],
      },
    },
    required: ["action", "parameters"],
  },
};

const providerError = (code, cause) => {
  const error = new Error("AI provider request failed");
  error.code = code;
  error.cause = cause;
  return error;
};

const normalizeGroqError = (error) => {
  if (error.code === "ai_provider_not_configured") return error;
  // Keep the provider's reason visible in Render without logging the prompt,
  // completion, API key, or request headers.
  console.error("[Groq] API request failed:", JSON.stringify({
    status: Number(error.status) || null,
    code: typeof error.code === "string" ? error.code : null,
    type: typeof error.type === "string" ? error.type : null,
    message: typeof error.message === "string" ? error.message.slice(0, 500) : null,
    requestId: typeof error.request_id === "string" ? error.request_id.slice(0, 100) : null,
  }));
  if (error.status === 401 || error.status === 403) return providerError("ai_provider_auth_failed", error);
  if (error.status === 429) return providerError("ai_provider_rate_limited", error);
  if (error.status === 404 || error.status === 400) return providerError("ai_provider_response_invalid", error);
  if (error.name === "AbortError" || error.code === "ETIMEDOUT") return providerError("ai_provider_timeout", error);
  return providerError("ai_provider_unavailable", error);
};

const createGroqProvider = ({ config = getAIConfig(), client } = {}) => {
  const settings = validateAIConfig(config);
  const groq = client || new Groq({ apiKey: settings.groqApiKey, timeout: 15000, maxRetries: 2 });
  return {
    async generateIntent(prompt) {
      const request = (model) => groq.chat.completions.create({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: JSON.stringify({ userRequest: prompt.userRequest, untrustedRetrievedContent: prompt.untrustedRetrievedContent, trustedConversationContext: prompt.trustedConversationContext }) },
        ],
        response_format: { type: "json_schema", json_schema: INTENT_SCHEMA },
      });
      try {
        let completion;
        try {
          completion = await request(settings.groqModel);
        } catch (error) {
          // 429 on the primary model: try the fallback model once. Each model
          // has its own rate-limit bucket, so this usually succeeds. (The SDK
          // has already retried the primary with backoff before we get here.)
          const fallback = settings.groqFallbackModel;
          if (error.status === 429 && fallback && fallback !== settings.groqModel) {
            console.warn(`[AI DEBUG] ${settings.groqModel} rate limited; retrying with ${fallback}`);
            completion = await request(fallback);
          } else throw error;
        }
        const content = completion?.choices?.[0]?.message?.content;
        if (typeof content !== "string") throw providerError("ai_provider_structured_output_failed");
        try { return JSON.parse(content); } catch { throw providerError("ai_provider_structured_output_failed"); }
      } catch (error) {
        throw error.code?.startsWith("ai_provider_") ? error : normalizeGroqError(error);
      }
    },
  };
};

module.exports = { INTENT_SCHEMA, createGroqProvider, normalizeGroqError };
