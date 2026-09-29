const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_GROQ_MODEL, getAIConfig } = require("../src/config/ai");
const { createGroqProvider } = require("../src/services/ai/groqProvider");
const { createAIGateway } = require("../src/services/ai/aiGateway");

const fullParameters = (values = {}) => ({
  body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null,
  eventId: null, summary: null, description: null, location: null, startDateTime: null, endDateTime: null,
  timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
  ...values,
});

test("Groq configuration defaults to the configured OSS model", () => {
  assert.equal(getAIConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "test" }).groqModel, DEFAULT_GROQ_MODEL);
});
test("Groq configuration fails safely without an API key", () => {
  assert.throws(() => createGroqProvider({ config: { provider: "groq", groqApiKey: null, groqModel: DEFAULT_GROQ_MODEL } }), { code: "ai_provider_not_configured" });
});
test("Groq provider schema and parser preserve the full validator parameter contract", async () => {
  let request;
  const provider = createGroqProvider({ config: { provider: "groq", groqApiKey: "test", groqModel: DEFAULT_GROQ_MODEL }, client: { chat: { completions: { create: async (input) => { request = input; return { choices: [{ message: { content: JSON.stringify({ action: "gmail.search", parameters: fullParameters({ query: "invoices" }) }) } }] }; } } } } });
  const intent = await provider.generateIntent({ system: "system", userRequest: "request", untrustedRetrievedContent: [], trustedConversationContext: { gmailMessageIds: ["trusted"] } });
  assert.equal(request.response_format.type, "json_schema");
  assert.deepEqual(intent, { action: "gmail.search", parameters: fullParameters({ query: "invoices" }) });
  assert.deepEqual(JSON.parse(request.messages[1].content).trustedConversationContext, { gmailMessageIds: ["trusted"] });
});

test("Groq chat.respond structured output parses with all nullable fields", async () => {
  const expected = { action: "chat.respond", parameters: fullParameters({ body: "Hello! How can I help?" }) };
  const provider = createGroqProvider({ config: { provider: "groq", groqApiKey: "test", groqModel: DEFAULT_GROQ_MODEL }, client: { chat: { completions: { create: async (input) => ({
    choices: [{ message: { content: JSON.stringify(expected) } }],
  }) } } } });
  const parsed = await provider.generateIntent({ system: "system", userRequest: "Hello NOMI", untrustedRetrievedContent: [], trustedConversationContext: {} });
  assert.deepEqual(parsed, expected);
  assert.deepEqual(Object.keys(parsed.parameters).sort(), Object.keys(fullParameters()).sort());
});

test("Groq structured chat response passes parser and gateway validator unchanged", async () => {
  const expected = { action: "chat.respond", parameters: fullParameters({ body: "Hello!" }) };
  const groq = createGroqProvider({ config: { provider: "groq", groqApiKey: "test", groqModel: DEFAULT_GROQ_MODEL }, client: { chat: { completions: { create: async () => ({
    choices: [{ message: { content: JSON.stringify(expected) } }],
  }) } } } });
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq } });
  const result = await gateway.generateIntent({ userRequest: "Hello NOMI" });
  assert.equal(result.status, "proposed");
  assert.deepEqual(result.intent, expected);
});

test("Groq provider preserves a structured self-recipient marker without an address", async () => {
  const provider = createGroqProvider({ config: { provider: "groq", groqApiKey: "test", groqModel: DEFAULT_GROQ_MODEL }, client: { chat: { completions: { create: async () => ({
    choices: [{ message: { content: '{"action":"gmail.draft","parameters":{"body":"hello","maxResults":null,"messageId":null,"query":null,"recipient":"my own email address","subject":null}}' } }],
  }) } } } });
  const intent = await provider.generateIntent({ system: "system", userRequest: "Draft an email to my own email address saying hello.", untrustedRetrievedContent: [], trustedConversationContext: { gmailMessageIds: [] } });
  assert.equal(intent.action, "gmail.draft");
  assert.equal(intent.parameters.recipient, "my own email address");
  assert.equal(intent.parameters.recipient.includes("@"), false);
});

test("Groq provider retries a rate-limited request on the fallback model", async () => {
  const calls = [];
  const provider = createGroqProvider({
    config: { provider: "groq", groqApiKey: "test", groqModel: "primary-model", groqFallbackModel: "fallback-model" },
    client: { chat: { completions: { create: async ({ model }) => {
      calls.push(model);
      if (model === "primary-model") throw Object.assign(new Error("rate limited"), { status: 429 });
      return { choices: [{ message: { content: JSON.stringify({ action: "clarification", parameters: fullParameters({ body: "When?" }) }) } }] };
    } } } },
  });
  const intent = await provider.generateIntent({ system: "s", userRequest: "r", untrustedRetrievedContent: [], trustedConversationContext: {} });
  assert.deepEqual(calls, ["primary-model", "fallback-model"]);
  assert.equal(intent.action, "clarification");
});

test("Groq provider reports ai_provider_rate_limited when the fallback is limited too", async () => {
  const provider = createGroqProvider({
    config: { provider: "groq", groqApiKey: "test", groqModel: "a", groqFallbackModel: "b" },
    client: { chat: { completions: { create: async () => { throw Object.assign(new Error("rate limited"), { status: 429 }); } } } },
  });
  await assert.rejects(() => provider.generateIntent({ system: "s", userRequest: "r", untrustedRetrievedContent: [], trustedConversationContext: {} }), { code: "ai_provider_rate_limited" });
});
