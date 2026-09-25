const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGateway } = require("../src/services/ai/aiGateway");
const fullParams = (values = {}) => ({
  body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null,
  eventId: null, summary: null, description: null, location: null, startDateTime: null, endDateTime: null,
  timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
  ...values,
});
test("gateway routes a safe payload to a generic adapter without mappings", async () => {
  let received;
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async (prompt) => { received = prompt; return { action: "gmail.search", parameters: fullParams({ query: "[PERSON_1]" }) }; } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Search [PERSON_1]", untrustedRetrievedContent: [] } });
  assert.equal(result.status, "proposed"); assert.equal(received.userRequest, "Search [PERSON_1]"); assert.equal(Object.hasOwn(received, "placeholderMappings"), false);
});
test("gateway normalizes provider failures", async () => {
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => { const error = new Error(); error.code = "ai_provider_timeout"; throw error; } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Search mail", untrustedRetrievedContent: [] } });
  assert.deepEqual(result, { status: "provider_error", provider: "groq", reason: "ai_provider_timeout" });
});

test("person search phrases are deterministic Gmail search intents without calling the planner", async () => {
  const phrases = [
    ["search paul", "paul"],
    ["search for paul", "paul"],
    ["find paul", "paul"],
    ["find my contact paul", "paul"],
    ["search for the user paul", "paul"],
    ["search paul he is a contact", "paul"],
    ["Search Gmail for Paul", "paul"],
  ];
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => { throw new Error("planner should not run"); } } } });
  for (const [message, name] of phrases) {
    const result = await gateway.generateIntent({ safeInput: { userRequest: message, untrustedRetrievedContent: [] } });
    assert.equal(result.status, "proposed", message);
    assert.equal(result.intent.action, "gmail.search", message);
    assert.equal(result.intent.parameters.query, `{from:${name} to:${name}}`, message);
  }
});

test("person search does not reclassify arbitrary email queries as contact searches", async () => {
  let called = false;
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => { called = true; return { action: "gmail.search", parameters: fullParams({ query: "is:unread" }) }; } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "find my unread emails from last week", untrustedRetrievedContent: [] } });
  assert.equal(called, true);
  assert.equal(result.status, "proposed");
});
