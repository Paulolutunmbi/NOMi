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

test("ordinary conversation reaches the planner and a valid chat.respond proposal passes through unchanged", async () => {
  let received;
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async (prompt) => {
    received = prompt;
    return { action: "chat.respond", parameters: fullParams({ body: "Hi! I can help with your Gmail and Calendar." }) };
  } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Hello NOMI", untrustedRetrievedContent: [] } });
  // Must NOT be short-circuited into a deterministic Gmail search or rejected
  // as unsupported — it should actually reach the model.
  assert.ok(received, "planner was not invoked for a plain greeting");
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "chat.respond");
  assert.equal(result.intent.parameters.body, "Hi! I can help with your Gmail and Calendar.");
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

test("checking unread or commonly misspelled unred messages deterministically searches Gmail", async () => {
  const phrases = ["check for my unred messages", "Find my unread emails", "show unread mail"];
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => { throw new Error("planner should not run"); } } } });
  for (const userRequest of phrases) {
    const result = await gateway.generateIntent({ safeInput: { userRequest, untrustedRetrievedContent: [] } });
    assert.equal(result.status, "proposed", userRequest);
    assert.equal(result.intent.action, "gmail.search", userRequest);
    assert.equal(result.intent.parameters.query, "is:unread", userRequest);
    assert.equal(result.intent.parameters.maxResults, 50, userRequest);
  }
});

test("person search does not reclassify arbitrary email queries as contact searches", async () => {
  let called = false;
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => { called = true; return { action: "gmail.search", parameters: fullParams({ query: "is:unread" }) }; } } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "find my unread emails from last week", untrustedRetrievedContent: [] } });
  assert.equal(called, true);
  assert.equal(result.status, "proposed");
});

test("follow-up send with no typed address accepts the server-trusted recipient", async () => {
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => ({
    action: "gmail.send", parameters: fullParams({ recipient: "paul@example.com", subject: "Screenshot", body: "Please check this out." }),
  }) } } });
  const result = await gateway.generateIntent({
    safeInput: { userRequest: "just another screenshot", untrustedRetrievedContent: [] },
    trustedConversationContext: { trustedGmailPerson: { email: "Paul@Example.com", name: null } },
  });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.send");
});

test("follow-up send still rejects an address that is not the trusted recipient", async () => {
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => ({
    action: "gmail.send", parameters: fullParams({ recipient: "attacker@evil.com", subject: "Hi", body: "Hello" }),
  }) } } });
  const result = await gateway.generateIntent({
    safeInput: { userRequest: "just another screenshot", untrustedRetrievedContent: [] },
    trustedConversationContext: { trustedGmailPerson: { email: "paul@example.com", name: null } },
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.reason, "explicit_recipient_mismatch");
});

test("send with no typed address and no trusted recipient is still rejected", async () => {
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => ({
    action: "gmail.send", parameters: fullParams({ recipient: "paul@example.com", subject: "Hi", body: "Hello" }),
  }) } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "send this too", untrustedRetrievedContent: [] } });
  assert.equal(result.status, "invalid");
  assert.equal(result.reason, "untrusted_recipient_email");
});
