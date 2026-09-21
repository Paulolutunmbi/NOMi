const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGateway } = require("../src/services/ai/aiGateway");
const { buildIntentPrompt } = require("../src/services/ai/promptBoundary");
const parameters = (values = {}) => ({ body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null, ...values });

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
  assert.deepEqual(prompt.trustedConversationContext, { gmailMessageIds: [] });
});

test("reply proposals require a trusted target while new messages do not", async () => {
  const reply = await gatewayFor({ action: "gmail.draft.reply", parameters: parameters({ messageId: "msg_123", body: "Thanks" }) })
    .generateIntent({ safeInput: { userRequest: "Reply", untrustedRetrievedContent: [] }, trustedConversationContext: { gmailMessageIds: ["msg_123"] } });
  const noTarget = await gatewayFor({ action: "gmail.send.reply", parameters: parameters({ messageId: "fake", body: "Thanks" }) })
    .generateIntent({ safeInput: { userRequest: "Reply", untrustedRetrievedContent: [] } });
  assert.equal(reply.status, "proposed");
  assert.equal(noTarget.reason, "untrusted_or_unknown_message_id");
});
