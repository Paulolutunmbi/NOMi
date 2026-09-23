const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGateway } = require("../src/services/ai/aiGateway");
const { buildIntentPrompt } = require("../src/services/ai/promptBoundary");
const parameters = (values = {}) => ({
  body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null,
  eventId: null, summary: null, description: null, location: null, startDateTime: null, endDateTime: null,
  timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
  ...values,
});

const gatewayFor = (intent) => createAIGateway({
  providerName: "groq",
  adapters: { groq: { generateIntent: async () => intent } },
});

test("Gmail search proposals cover unread date-based criteria", async () => {
  const result = await gatewayFor({ action: "gmail.search", parameters: parameters({ query: "is:unread newer_than:7d" }) })
    .generateIntent({ safeInput: { userRequest: "Find my unread emails from the last 7 days.", untrustedRetrievedContent: [] } });
  assert.deepEqual(result.intent, { action: "gmail.search", parameters: parameters({ query: "is:unread newer_than:7d" }) });
});

test("a natural-language email description is proposed as Gmail search, not Gmail read", async () => {
  const result = await gatewayFor({ action: "gmail.search", parameters: parameters({ query: "from:John project" }) })
    .generateIntent({ safeInput: { userRequest: "Read the email from John about the project.", untrustedRetrievedContent: [] } });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.search");
  assert.equal(result.intent.parameters.messageId, null);
});

test("Gmail read proposals require a messageId supplied by trusted conversation context", async () => {
  const messageId = "18f4e7a9c1234567";
  const result = await gatewayFor({ action: "gmail.read", parameters: parameters({ messageId }) })
    .generateIntent({ safeInput: { userRequest: "Read this email", untrustedRetrievedContent: [] }, trustedConversationContext: { gmailMessageIds: [messageId] } });
  assert.deepEqual(result.intent, { action: "gmail.read", parameters: parameters({ messageId }) });
});

test("the proposal layer rejects invented, missing, and untrusted Gmail message IDs", async () => {
  const invented = await gatewayFor({ action: "gmail.read", parameters: parameters({ messageId: "invented-message-id" }) })
    .generateIntent({ safeInput: { userRequest: "Read this email", untrustedRetrievedContent: [] }, trustedConversationContext: { gmailMessageIds: ["trusted-message-id"] } });
  const missing = await gatewayFor({ action: "gmail.read", parameters: parameters() })
    .generateIntent({ safeInput: { userRequest: "Read the email from John about the project.", untrustedRetrievedContent: [] } });
  assert.equal(invented.status, "invalid");
  assert.equal(invented.reason, "untrusted_or_unknown_message_id");
  assert.equal(missing.status, "invalid");
  assert.equal(missing.reason, "missing_or_invalid_parameter");
});

test("a user-supplied arbitrary message ID cannot become a search or read target", async () => {
  let called = false;
  const gateway = createAIGateway({
    providerName: "groq",
    adapters: { groq: { generateIntent: async () => { called = true; return { action: "gmail.search", parameters: parameters({ query: "abc123" }) }; } } },
  });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Read Gmail message abc123.", untrustedRetrievedContent: [] } });
  assert.equal(result.status, "invalid");
  assert.equal(result.reason, "untrusted_or_unknown_message_id");
  assert.equal(called, false);
});

test("the model policy makes Gmail action preconditions explicit without changing trust boundaries", () => {
  const prompt = buildIntentPrompt({ userRequest: "Read the email from John about the project.", untrustedRetrievedContent: [] });
  assert.match(prompt.system, /gmail\.search: propose/i);
  assert.match(prompt.system, /gmail\.read: messageId is required/i);
  assert.match(prompt.system, /never invent/i);
  assert.match(prompt.system, /propose gmail\.search first/i);
  assert.match(prompt.system, /Do not execute that search/i);
  assert.match(prompt.system, /Identity resolution remains outside the model/i);
  assert.deepEqual(prompt.trustedConversationContext.gmailMessageIds, []);
  assert.deepEqual(prompt.trustedConversationContext.calendarEventIds, []);
  assert.equal(typeof prompt.trustedConversationContext.serverTime, "string");
});

test("reply proposals require a trusted target and unknown targets return clarification", async () => {
  const reply = await gatewayFor({ action: "gmail.draft.reply", parameters: parameters({ messageId: "msg_123", body: "Thanks" }) })
    .generateIntent({ safeInput: { userRequest: "Reply", untrustedRetrievedContent: [] }, trustedConversationContext: { gmailMessageIds: ["msg_123"] } });
  const noTarget = await gatewayFor({ action: "gmail.send.reply", parameters: parameters({ messageId: "fake", body: "Thanks" }) })
    .generateIntent({ safeInput: { userRequest: "Reply", untrustedRetrievedContent: [] } });
  assert.equal(reply.status, "proposed");
  assert.equal(reply.intent.action, "gmail.draft.reply");
  assert.equal(reply.intent.parameters.messageId, "msg_123");
  assert.equal(noTarget.status, "proposed");
  assert.equal(noTarget.intent.action, "clarification");
  assert.match(noTarget.intent.parameters.body, /Who would you like/i);
});

test("known target with 'him' or 'her' pronoun resolves to gmail.draft.reply with trusted ID", async () => {
  const himResult = await gatewayFor({ action: "gmail.draft.reply", parameters: parameters({ messageId: "msg_john", body: "I will send it tomorrow, don't worry." }) })
    .generateIntent({
      safeInput: { userRequest: "Craft a reply telling him I'll send it tomorrow and he shouldn't worry.", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: ["msg_john"] },
    });
  assert.equal(himResult.status, "proposed");
  assert.equal(himResult.intent.action, "gmail.draft.reply");
  assert.equal(himResult.intent.parameters.messageId, "msg_john");

  const herResult = await gatewayFor({ action: "gmail.draft.reply", parameters: parameters({ messageId: "msg_mary", body: "I will send it tomorrow." }) })
    .generateIntent({
      safeInput: { userRequest: "Craft a reply telling her I'll send it tomorrow.", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: ["msg_mary"] },
    });
  assert.equal(herResult.status, "proposed");
  assert.equal(herResult.intent.action, "gmail.draft.reply");
  assert.equal(herResult.intent.parameters.messageId, "msg_mary");
});

test("unknown 'him' or pronoun without target context produces clarification and no Gmail search", async () => {
  // Even if adapter mistakenly returned gmail.search, safety policy returns clarification
  const resultWithSearchAdapter = await gatewayFor({ action: "gmail.search", parameters: parameters({ query: "him" }) })
    .generateIntent({
      safeInput: { userRequest: "craft a message telling him that i ill send it tomorrow and that he shouldn't worry", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: [] },
    });
  assert.equal(resultWithSearchAdapter.status, "proposed");
  assert.equal(resultWithSearchAdapter.intent.action, "clarification");
  assert.equal(resultWithSearchAdapter.intent.parameters.query, null);
  assert.match(resultWithSearchAdapter.intent.parameters.body, /Who would you like/i);

  // When adapter directly proposes clarification
  const resultWithClarificationAdapter = await gatewayFor({ action: "clarification", parameters: parameters({ body: "Who would you like me to send this to?" }) })
    .generateIntent({
      safeInput: { userRequest: "craft a message telling him that i ill send it tomorrow", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: [] },
    });
  assert.equal(resultWithClarificationAdapter.status, "proposed");
  assert.equal(resultWithClarificationAdapter.intent.action, "clarification");
  assert.equal(resultWithClarificationAdapter.intent.parameters.body, "Who would you like me to send this to?");
});

test("explicit request to find/search target and reply proposes gmail.search_then_reply", async () => {
  // This is the compound "search then act" case — the adapter correctly returns the compound intent.
  const result = await gatewayFor({ action: "gmail.search_then_reply", parameters: parameters({ query: "from:John", body: "I'll send it tomorrow." }) })
    .generateIntent({
      safeInput: { userRequest: "Find John's email and reply saying I'll send it tomorrow.", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: [] },
    });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.search_then_reply");
  assert.equal(result.intent.parameters.query, "from:John");
  assert.equal(result.intent.parameters.body, "I'll send it tomorrow.");
  // messageId MUST be null — the model must never invent an ID
  assert.equal(result.intent.parameters.messageId, null);
  assert.equal(result.intent.parameters.recipient, null);
});

test("explicit recipient email is proposed as gmail.draft", async () => {
  const result = await gatewayFor({ action: "gmail.draft", parameters: parameters({ recipient: "[EMAIL_1]", body: "I'll send it tomorrow." }) })
    .generateIntent({
      safeInput: { userRequest: "Draft an email to [EMAIL_1] saying I'll send it tomorrow.", untrustedRetrievedContent: [] },
      placeholderMappings: { "[EMAIL_1]": { type: "EMAIL", value: "john@example.com" } },
    });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.draft");
  assert.equal(result.intent.parameters.recipient, "[EMAIL_1]");
  assert.equal(result.intent.parameters.body, "I'll send it tomorrow.");
});

test("drafting to oneself is proposed as gmail.draft, not gmail.search", async () => {
  const selfTests = [
    { request: "Draft an email to myself saying this is a NOMI test.", recipient: "myself", body: "this is a NOMI test" },
    { request: "Draft an email to my own email address saying this is a NOMI test.", recipient: "my own email address", body: "this is a NOMI test" },
    { request: "Draft an email to me saying hello.", recipient: "me", body: "hello" },
  ];

  for (const { request, recipient, body } of selfTests) {
    const result = await gatewayFor({ action: "gmail.draft", parameters: parameters({ recipient, body }) })
      .generateIntent({ safeInput: { userRequest: request, untrustedRetrievedContent: [] } });
    assert.equal(result.status, "proposed", request);
    assert.equal(result.intent.action, "gmail.draft", request);
    assert.equal(result.intent.parameters.recipient, recipient, request);
    assert.equal(result.intent.parameters.body, body, request);
    assert.equal(result.intent.parameters.query, null, request);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Compound search-then-act intent planning (Requirement 1 taxonomy)
// ─────────────────────────────────────────────────────────────────────────────

test("pure search request stays as gmail.search (no compound intent)", async () => {
  const result = await gatewayFor({ action: "gmail.search", parameters: parameters({ query: "from:Paul" }) })
    .generateIntent({
      safeInput: { userRequest: "Find Paul's email.", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: [] },
    });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.search");
  assert.equal(result.intent.parameters.messageId, null);
});

test("search+draft-reply request produces gmail.search_then_draft_reply with query and body", async () => {
  const result = await gatewayFor({ action: "gmail.search_then_draft_reply", parameters: parameters({ query: "from:Paul", body: "I'll send the files tomorrow." }) })
    .generateIntent({
      safeInput: { userRequest: "Find Paul's email and draft a reply saying I'll send the files tomorrow.", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: [] },
    });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.search_then_draft_reply");
  assert.equal(result.intent.parameters.query, "from:Paul");
  assert.equal(result.intent.parameters.body, "I'll send the files tomorrow.");
  assert.equal(result.intent.parameters.messageId, null);
});

test("search+send-reply request produces gmail.search_then_send_reply with query and body", async () => {
  const result = await gatewayFor({ action: "gmail.search_then_send_reply", parameters: parameters({ query: "from:Paul", body: "I'll send the files tomorrow." }) })
    .generateIntent({
      safeInput: { userRequest: "Find Paul's email and send a reply saying I'll send the files tomorrow.", untrustedRetrievedContent: [] },
      trustedConversationContext: { gmailMessageIds: [] },
    });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "gmail.search_then_send_reply");
  assert.equal(result.intent.parameters.query, "from:Paul");
  assert.equal(result.intent.parameters.body, "I'll send the files tomorrow.");
  assert.equal(result.intent.parameters.messageId, null);
});

test("compound intent validator rejects non-null messageId in search_then_reply (model cannot inject an ID)", async () => {
  // Even if the model returns a messageId, it must be rejected as an unexpected parameter for compound intents.
  const { validateIntent } = require("../src/services/ai/intentValidator");
  const result = validateIntent({ action: "gmail.search_then_reply", parameters: parameters({ query: "from:Paul", body: "Hello", messageId: "injected-id" }) });
  assert.equal(result.valid, false);
  assert.equal(result.reason, "unexpected_parameter");
});

test("prompt boundary includes compound intent instructions", () => {
  const { buildIntentPrompt } = require("../src/services/ai/promptBoundary");
  const prompt = buildIntentPrompt({ userRequest: "Find Paul's email and reply.", untrustedRetrievedContent: [] });
  assert.match(prompt.system, /gmail\.search_then_reply/);
  assert.match(prompt.system, /gmail\.search_then_send_reply/);
  assert.match(prompt.system, /The server resolves the trusted target after searching/i);
  // Original security assertions must still hold
  assert.match(prompt.system, /never invent/i);
  assert.match(prompt.system, /untrusted data/i);
});
