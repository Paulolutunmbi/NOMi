const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAIActionRouter } = require("../src/routes/aiActionRoutes");

const parameters = (values = {}) => ({
  body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null,
  eventId: null, summary: null, description: null, location: null, startDateTime: null, endDateTime: null,
  timeZone: null, attendees: null, addMeet: null, ...values,
});

const harness = async (record, gatewayIntent) => {
  const gatewayCalls = [];
  const executeCalls = [];
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
    gateway: { generateIntent: async (input) => { gatewayCalls.push(input); return { status: "proposed", intent: gatewayIntent }; } },
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
