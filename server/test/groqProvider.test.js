const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_GROQ_MODEL, getAIConfig } = require("../src/config/ai");
const { createGroqProvider } = require("../src/services/ai/groqProvider");

test("Groq configuration defaults to the configured OSS model", () => {
  assert.equal(getAIConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "test" }).groqModel, DEFAULT_GROQ_MODEL);
});
test("Groq configuration fails safely without an API key", () => {
  assert.throws(() => createGroqProvider({ config: { provider: "groq", groqApiKey: null, groqModel: DEFAULT_GROQ_MODEL } }), { code: "ai_provider_not_configured" });
});
test("Groq provider requests structured JSON and parses it", async () => {
  let request;
  const provider = createGroqProvider({ config: { provider: "groq", groqApiKey: "test", groqModel: DEFAULT_GROQ_MODEL }, client: { chat: { completions: { create: async (input) => { request = input; return { choices: [{ message: { content: '{"action":"gmail.search","parameters":{"query":"invoices"}}' } }] }; } } } } });
  const intent = await provider.generateIntent({ system: "system", userRequest: "request", untrustedRetrievedContent: [] });
  assert.equal(request.response_format.type, "json_schema");
  assert.deepEqual(intent, { action: "gmail.search", parameters: { query: "invoices" } });
});
