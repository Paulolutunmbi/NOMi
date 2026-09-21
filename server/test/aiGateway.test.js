const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGateway } = require("../src/services/ai/aiGateway");
test("gateway routes a safe payload to a generic adapter without mappings", async () => {
  let received;
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async (prompt) => { received = prompt; return { action: "gmail.search", parameters: { body: null, maxResults: null, messageId: null, query: "[PERSON_1]", recipient: null, subject: null } }; } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Search [PERSON_1]", untrustedRetrievedContent: [] } });
  assert.equal(result.status, "proposed"); assert.equal(received.userRequest, "Search [PERSON_1]"); assert.equal(Object.hasOwn(received, "placeholderMappings"), false);
});
test("gateway normalizes provider failures", async () => {
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => { const error = new Error(); error.code = "ai_provider_timeout"; throw error; } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Search mail", untrustedRetrievedContent: [] } });
  assert.deepEqual(result, { status: "provider_error", provider: "groq", reason: "ai_provider_timeout" });
});
