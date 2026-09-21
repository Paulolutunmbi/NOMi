const test = require("node:test");
const assert = require("node:assert/strict");
const { createActionOrchestrator } = require("../src/services/actions/actionOrchestrator");
const { sanitizeAuditMetadata } = require("../src/services/actions/actionExecutor");

const params = (values = {}) => ({ body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null, ...values });
const conversationService = (record = { gmailMessageIds: [], gmailCandidates: [], retrievedContext: [] }) => ({
  getActive: async () => record,
  create: async () => record,
  update: async (values) => { Object.assign(record, values); return record; },
});
const searchResult = { messages: [
  { id: "message-a", from: { name: "Aminat Bello", email: "aminat@example.com" }, subject: "Kata", snippet: "Status", date: "2026-01-01" },
] };
const user = { _id: "u1" };

test("search uses the injected trusted executor and stores provider-derived IDs only in user context", async () => {
  const record = { gmailMessageIds: [], gmailCandidates: [], retrievedContext: [] };
  const calls = [];
  const orchestrator = createActionOrchestrator({ contextService: conversationService(record), actionExecutor: async (input) => { calls.push(input); return { status: "success", result: searchResult }; } });
  const result = await orchestrator.execute({ user, conversationId: "c1", message: "Find Aminat's email", proposal: { action: "gmail.search", parameters: params({ query: "from:Aminat" }) } });
  assert.equal(result.status, "success");
  assert.equal(calls[0].provider, "google");
  assert.equal(calls[0].action, "gmail.search");
  assert.deepEqual(record.gmailMessageIds, ["message-a"]);
  assert.equal(record.gmailCandidates[0].id, "message-a");
  assert.equal(JSON.stringify(result).includes("message-a"), false);
});

test("message actions reject missing or client-invented targets but accept a server-trusted target", async () => {
  const calls = [];
  const orchestrator = createActionOrchestrator({ contextService: conversationService({ gmailMessageIds: ["trusted-id"], gmailCandidates: [] }), actionExecutor: async (input) => { calls.push(input); return { status: "success", result: { id: "ignored" } }; } });
  const missing = await orchestrator.execute({ user, conversationId: "c", message: "Read this", proposal: { action: "gmail.read", parameters: params() } });
  const invented = await orchestrator.execute({ user, conversationId: "c", message: "Read message forged-id", proposal: { action: "gmail.read", parameters: params({ messageId: "forged-id" }) } });
  const trusted = await orchestrator.execute({ user, conversationId: "c", message: "Read this", proposal: { action: "gmail.read", parameters: params({ messageId: "trusted-id" }) } });
  assert.equal(missing.reason, "untrusted_or_unknown_message_id");
  assert.equal(invented.reason, "untrusted_or_unknown_message_id");
  assert.equal(trusted.status, "success");
  assert.equal(calls.length, 1);
});

test("new messages require an explicitly user-provided recipient and preserve executor approval behavior", async () => {
  const calls = [];
  const executor = async (input) => { calls.push(input); return input.approval === "allow_once" ? { status: "success", result: { accessToken: "never expose" } } : { status: "approval_required" }; };
  const orchestrator = createActionOrchestrator({ contextService: conversationService(), actionExecutor: executor });
  const proposal = { action: "gmail.send", parameters: params({ recipient: "john@example.com", body: "Files attached" }) };
  const rejected = await orchestrator.execute({ user, conversationId: "c", message: "Send files", proposal });
  const pending = await orchestrator.execute({ user, conversationId: "c", message: "Send john@example.com the files", proposal });
  const sent = await orchestrator.execute({ user, conversationId: "c", message: "Send john@example.com the files", proposal, approval: "allow_once" });
  assert.equal(rejected.reason, "untrusted_recipient_email");
  assert.equal(pending.status, "approval_required");
  assert.equal(sent.status, "success");
  assert.equal(JSON.stringify(sent).includes("never expose"), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].approval, "allow_once");
});

test("a reply resolves one provider candidate server-side and never auto-selects an ambiguity", async () => {
  const calls = [];
  const record = { gmailMessageIds: ["a", "b"], gmailCandidates: [
    { id: "a", displayName: "Aminat Bello", email: "a@example.com" },
    { id: "b", displayName: "Aminat Yusuf", email: "b@example.com" },
  ] };
  const orchestrator = createActionOrchestrator({ contextService: conversationService(record), actionExecutor: async (input) => { calls.push(input); return { status: "success", result: {} }; } });
  const proposal = { action: "gmail.draft.reply", parameters: params({ messageId: "a", body: "Thanks" }) };
  const ambiguous = await orchestrator.execute({ user, conversationId: "c", message: "Draft a reply to Aminat about Kata", proposal });
  assert.equal(ambiguous.status, "ambiguous_identity");
  assert.equal(calls.length, 0);
  record.gmailCandidates = [{ id: "a", displayName: "Aminat Bello", email: "a@example.com" }];
  const resolved = await orchestrator.execute({ user, conversationId: "c", message: "Draft a reply to Aminat Bello about Kata", proposal });
  assert.equal(resolved.status, "success");
  assert.equal(calls[0].payload.messageId, "a");
});

test("unsupported actions cannot reach the executor", async () => {
  let called = false;
  const orchestrator = createActionOrchestrator({ contextService: conversationService(), actionExecutor: async () => { called = true; return { status: "success" }; } });
  const result = await orchestrator.execute({ user, conversationId: "c", message: "delete all mail", proposal: { action: "gmail.delete", parameters: params() } });
  // The route/gateway rejects this before orchestration; defense in depth here
  // rejects it as an invalid proposal too.
  assert.equal(result.status, "rejected");
  assert.equal(called, false);
});

test("audit metadata excludes message bodies and OAuth credentials", () => {
  assert.deepEqual(sanitizeAuditMetadata({ messageId: "m1", body: "private body", snippet: "private snippet", accessToken: "secret", count: 1 }), { messageId: "m1", count: 1 });
});
