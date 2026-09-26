const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAIActionRouter, explicitRecipient, explicitBody } = require("../src/routes/aiActionRoutes");
const { createAIGateway } = require("../src/services/ai/aiGateway");

test("explicit recipient extraction preserves a typed address for deterministic Gmail drafts", () => {
  assert.equal(explicitRecipient("Tell him I am good, him paulolutunmbi0@gmail.com"), "paulolutunmbi0@gmail.com");
  assert.equal(explicitRecipient("Send it to <PAUL@example.com>"), "paul@example.com");
  assert.equal(explicitRecipient("Draft a note to Paul"), null);
  assert.equal(explicitBody("Tell this person that I am good, him [paul@example.com](mailto:paul@example.com)"), "I am good");
  assert.equal(explicitRecipient("Good morning, send a mail to [PAUL@example.com](mailto:PAUL@example.com)"), "paul@example.com");
  assert.equal(explicitRecipient("mailto:PAUL@example.com"), "paul@example.com");
});

const parameters = (values = {}) => ({
  body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null,
  eventId: null, summary: null, description: null, location: null, startDateTime: null, endDateTime: null,
  timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null, ...values,
});

const harness = async (record, gatewayIntent) => {
  const gatewayCalls = [];
  const executeCalls = [];
  let planIndex = 0;
  const contextService = {
    getActive: async () => record,
    create: async () => record,
    update: async (changes) => { Object.assign(record, changes); return record; },
  };
  const orchestrator = { execute: async (input) => {
    executeCalls.push(input);
    return { status: "success", action: input.proposal?.action || "gmail.send.reply", result: {} };
  } };
  const app = express();
  app.use(express.json());
  app.use("/api/ai", createAIActionRouter({
    contextService, orchestrator,
    gateway: { generateIntent: async (input) => { gatewayCalls.push(input); const intent = Array.isArray(gatewayIntent) ? gatewayIntent[Math.min(planIndex++, gatewayIntent.length - 1)] : gatewayIntent; return { status: "proposed", intent }; } },
    getUser: async () => ({ _id: "u1" }), config: { provider: "groq" },
    authMiddleware: (req, res, next) => { req.user = { uid: "u1" }; next(); },
  }));
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  const request = async (message) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/execute`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "same", message }),
    });
    return { status: response.status, body: await response.json() };
  };
  return { request, gatewayCalls, executeCalls, close: () => new Promise((resolve) => server.close(resolve)) };
};

test("explicit recipient is trusted in the user/chat context before gateway validation", async (t) => {
  const record = { messages: [] };
  const h = await harness(record, { action: "clarification", parameters: parameters({ body: "What should I say?" }) });
  t.after(h.close);
  await h.request("Good morning, send a mail to [PAUL@example.com](mailto:PAUL@example.com)");
  assert.deepEqual(record.trustedGmailPerson, { email: "paul@example.com", name: null, source: "explicit_user_email" });
  assert.equal(h.gatewayCalls.length, 1);
  assert.equal(record.trustedGmailPerson.source, "explicit_user_email");
});

test("execute route passes the explicit address through real gateway validation into pending approval", async (t) => {
  const record = { messages: [] };
  const explicit = "alice@example.com";
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => ({ action: "gmail.send", parameters: parameters({ recipient: explicit, subject: "Hello", body: "Good morning." }) }) } } });
  const contextService = { getActive: async () => record, create: async () => record, update: async (changes) => Object.assign(record, changes) };
  const outcomes = [];
  const app = express(); app.use(express.json());
  app.use("/api/ai", createAIActionRouter({ contextService, gateway,
    orchestrator: { execute: async (input) => { outcomes.push(input); return { status: "approval_required", action: input.proposal.action, pendingAction: { id: "pending-1", recipient: input.proposal.parameters.recipient, subject: input.proposal.parameters.subject, body: input.proposal.parameters.body } }; } },
    getUser: async () => ({ _id: "u1" }), config: { provider: "groq" }, authMiddleware: (req, res, next) => { req.user = { uid: "u1" }; next(); },
  }));
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/execute`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "same", message: "Good morning, send a mail to alice@example.com" }) });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.outcome.status, "approval_required");
  assert.equal(result.outcome.pendingAction.recipient, explicit);
  assert.equal(outcomes.length, 1);
});

test("real gateway rejects an AI recipient substitution for an explicit address", async () => {
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => ({ action: "gmail.send", parameters: parameters({ recipient: "bob@example.com", body: "Hello" }) }) } } });
  const result = await gateway.generateIntent({ safeInput: { userRequest: "Send an email to [EMAIL_1]", untrustedRetrievedContent: [] }, originalUserRequest: "Send an email to alice@example.com", explicitRecipientEmail: "alice@example.com", placeholderMappings: { "[EMAIL_1]": { type: "EMAIL", value: "alice@example.com" } } });
  assert.equal(result.status, "proposed");
  assert.equal(result.intent.action, "clarification");
});

test("explicit recipient plus body cannot become a Gmail search", async (t) => {
  const record = { messages: [] };
  const h = await harness(record, { action: "gmail.search", parameters: parameters({ query: "paul@example.com" }) });
  t.after(h.close);
  await h.request("Send an email to paul@example.com saying the meeting is tomorrow.");
  assert.equal(h.executeCalls[0].proposal.action, "gmail.send");
  assert.equal(h.executeCalls[0].proposal.parameters.recipient, "paul@example.com");
  assert.equal(h.executeCalls[0].proposal.parameters.body, "the meeting is tomorrow");
});

test("multi-turn explicit recipient survives clarification and resolves 'him' into a new draft", async (t) => {
  const record = { messages: [] };
  const clarify = { action: "clarification", parameters: parameters({ body: "Who would you like me to send this to?" }) };
  const h = await harness(record, [clarify, clarify, clarify]);
  t.after(h.close);
  await h.request("gm");
  await h.request("Good morning, send a mail to oluwatunmbipaul@gmail.com");
  await h.request("tell him that he can resume work");
  assert.equal(h.executeCalls.length, 3);
  assert.equal(h.executeCalls[2].proposal.action, "gmail.draft");
  assert.equal(h.executeCalls[2].proposal.parameters.recipient, "oluwatunmbipaul@gmail.com");
  assert.equal(h.executeCalls[2].proposal.parameters.body, "he can resume work");
  assert.equal(h.gatewayCalls[2].trustedConversationContext.trustedGmailPerson.email, "oluwatunmbipaul@gmail.com");
});

test("draft_created follow-ups plan an edit, while selections and trusted sends bypass the planner", async (t) => {
  const draft = { draftId: "draft-1", messageId: "message-1", action: "gmail.draft.reply", body: "Formal reply." };
  const edit = await harness(
    { pendingInteraction: { stage: "draft_created", action: "gmail.draft.reply", body: "Formal reply." }, trustedDraft: draft, messages: [] },
    { action: "gmail.draft.edit", parameters: parameters({ body: "Hey — I'll get back to you tomorrow!" }) },
  );
  t.after(edit.close);
  assert.equal((await edit.request("Make it more casual.")).status, 200);
  assert.equal(edit.gatewayCalls.length, 1);
  assert.equal(edit.executeCalls[0].proposal.action, "gmail.draft.edit");

  const selection = await harness(
    { pendingInteraction: { stage: "identity_selection", action: "gmail.draft.reply", body: "Hi", identityCandidates: [] }, messages: [] },
    { action: "gmail.search", parameters: parameters({ query: "must not run" }) },
  );
  t.after(selection.close);
  await selection.request("1");
  assert.equal(selection.gatewayCalls.length, 0);
  assert.equal(selection.executeCalls[0].proposal, null);

  const send = await harness(
    { pendingInteraction: { stage: "draft_created", action: "gmail.draft.reply", body: "Hi" }, trustedDraft: draft, messages: [] },
    { action: "gmail.search", parameters: parameters({ query: "must not run" }) },
  );
  t.after(send.close);
  await send.request("send it");
  assert.equal(send.gatewayCalls.length, 0);
  assert.equal(send.executeCalls[0].proposal, null);
});

test("Start New Email click resumes trusted no-history state without planner clarification", async (t) => {
  const route = await harness({
    pendingInteraction: { stage: "no_history", action: "gmail.draft.reply", body: "I am good.", selectedIdentity: { name: "Paul", email: "paul@example.com" } },
    messages: [],
  }, { action: "clarification", parameters: parameters({ body: "Who would you like to email?" }) });
  t.after(route.close);
  const response = await route.request("start_new_email");
  assert.equal(response.status, 200);
  assert.equal(route.gatewayCalls.length, 0);
  assert.equal(route.executeCalls[0].proposal, null);
});

test("trusted clicked person deterministically supplies recipient when planner asks who", async (t) => {
  const route = await harness({ trustedGmailPerson: { name: "Paul", email: "paul@example.com" }, messages: [] },
    { action: "clarification", parameters: parameters({ body: "Who would you like to send this to?" }) });
  t.after(route.close);
  await route.request("Tell him I am good.");
  assert.equal(route.gatewayCalls.length, 1);
  assert.equal(route.executeCalls[0].proposal.action, "gmail.draft");
  assert.equal(route.executeCalls[0].proposal.parameters.recipient, "paul@example.com");
  assert.equal(route.executeCalls[0].proposal.parameters.body, "I am good");
});

test("public execute route forwards a calendar proposal instead of treating it as invalid context", async (t) => {
  const route = await harness(
    { calendarEventIds: [], calendarCandidates: [], messages: [] },
    { action: "calendar.create", parameters: parameters({ summary: "Meeting", startDateTime: "2026-09-24T14:00:00+01:00", endDateTime: "2026-09-24T14:30:00+01:00" }) },
  );
  t.after(route.close);
  const response = await route.request("Create a meeting tomorrow at 2pm.");
  assert.equal(response.status, 200);
  assert.equal(route.gatewayCalls.length, 1);
  assert.equal(route.executeCalls[0].proposal.action, "calendar.create");
});
