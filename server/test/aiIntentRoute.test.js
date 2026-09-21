const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createAIIntentRouter } = require("../src/routes/aiIntentRoutes");

const parameters = (values = {}) => ({ body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null, ...values });

const makeHarness = async () => {
  const records = new Map();
  const calls = [];
  const contextService = {
    getActive: async ({ userId, conversationId }) => records.get(`${userId}:${conversationId}`) || null,
    create: async ({ userId, conversationId }) => {
      const record = { user: userId, conversationId, gmailMessageIds: userId === "u1" ? ["msg_123"] : ["other_msg"] };
      records.set(`${userId}:${conversationId}`, record); return record;
    },
    update: async () => null,
  };
  const authMiddleware = (req, res, next) => {
    if (req.headers.authorization === "Bearer valid-u1") { req.user = { uid: "u1" }; return next(); }
    if (req.headers.authorization === "Bearer valid-u2") { req.user = { uid: "u2" }; return next(); }
    return res.status(401).json({ success: false });
  };
  const gateway = { generateIntent: async (input) => { calls.push(input); return { status: "proposed", intent: { action: "gmail.search", parameters: parameters({ query: "is:unread" }) } }; } };
  const app = express(); app.use(express.json());
  app.use("/api/ai", createAIIntentRouter({ gateway, contextService, authMiddleware, getUser: async ({ uid }) => ({ _id: uid }), audit: async () => {}, config: { provider: "groq" } }));
  const server = await new Promise((resolve) => { const value = app.listen(0, () => resolve(value)); });
  const request = async (body, token = "valid-u1") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/intent`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { calls, request, close: () => new Promise((resolve) => server.close(resolve)) };
};

test("AI route rejects unauthenticated and client-controlled security inputs", async (t) => {
  const harness = await makeHarness(); t.after(harness.close);
  assert.equal((await harness.request({ conversationId: "c", message: "find mail" }, "")).status, 401);
  assert.equal((await harness.request({ conversationId: "c", message: "find mail" }, "bad")).status, 401);
  for (const field of ["provider", "apiKey", "prompt", "permission", "action", "gmailMessageIds"]) {
    const result = await harness.request({ conversationId: "c", message: "find mail", [field]: "client value" });
    assert.equal(result.status, 400, field);
  }
  assert.equal((await harness.request({ conversationId: "c", message: "x".repeat(4001) })).status, 400);
  assert.equal(harness.calls.length, 0);
});

test("AI route supplies only user-bound server context and does not execute Gmail", async (t) => {
  const harness = await makeHarness(); t.after(harness.close);
  assert.equal((await harness.request({ conversationId: "same", message: "read this" })).status, 200);
  assert.deepEqual(harness.calls[0].trustedConversationContext, { gmailMessageIds: ["msg_123"] });
  assert.equal((await harness.request({ conversationId: "same", message: "read this" }, "valid-u2")).status, 200);
  assert.deepEqual(harness.calls[1].trustedConversationContext, { gmailMessageIds: ["other_msg"] });
  assert.equal(typeof harness.calls[0].execute, "undefined");
});
