const test = require("node:test");
const assert = require("node:assert/strict");
const { createActionExecutor, approvePendingSend, editPendingSend } = require("../src/services/actions/actionExecutor");

const fixture = () => {
  const records = new Map();
  let id = 0;
  const model = {
    async create(value) { const record = { ...value, _id: `00000000000000000000000${++id}` }; records.set(String(record._id), record); return record; },
    findOne(filter) { return { lean: async () => [...records.values()].find((r) => String(r._id) === String(filter._id) && String(r.user) === String(filter.user) && (!filter.conversationId || r.conversationId === filter.conversationId)) || null }; },
    findOneAndUpdate(filter, update) {
      const row = records.get(String(filter._id));
      if (!row || String(row.user) !== String(filter.user) || row.conversationId !== filter.conversationId || row.status !== filter.status) return null;
      if (filter.expiresAt && !(row.expiresAt > filter.expiresAt.$gt)) return null;
      if (update.$set["payload.recipient"] !== undefined) row.payload = { ...row.payload, recipient: update.$set["payload.recipient"], subject: update.$set["payload.subject"], body: update.$set["payload.body"] };
      Object.assign(row, Object.fromEntries(Object.entries(update.$set).filter(([key]) => !key.startsWith("payload."))));
      return { lean: async () => ({ ...row }) };
    },
    async updateOne(filter, update) { const row = records.get(String(filter._id)); if (row) Object.assign(row, update.$set); },
  };
  const sent = [];
  const executor = createActionExecutor({ pendingSendModel: model, check: async () => ({ allowed: true, decision: "always_allow" }), getProvider: () => ({ capabilities: ["gmail.send"], execute: async (input) => { sent.push(input); return { messageId: "sent-1" }; } }), audit: async () => {} });
  return { model, records, sent, executor };
};

test("gmail send always creates a pending one-time action even with persistent capability permission", async () => {
  const f = fixture();
  const result = await f.executor({ user: { _id: "u1" }, conversationId: "chat-a", provider: "google", action: "gmail.send", approval: "allow_once", payload: { recipient: "PAUL@example.com", subject: "Hi", body: "Hello" } });
  assert.equal(result.status, "approval_required");
  assert.equal(result.pendingAction.recipient, "paul@example.com");
  assert.equal(f.sent.length, 0);
  assert.equal(f.records.get(result.pendingAction.id).conversationId, "chat-a");
});

test("approval executes only the stored payload once and binds user and conversation", async () => {
  const f = fixture();
  const pending = await f.executor({ user: { _id: "u1" }, conversationId: "chat-a", provider: "google", action: "gmail.send", payload: { recipient: "paul@example.com", subject: "Hi", body: "Hello" } });
  const args = { userId: "u1", conversationId: "chat-a", actionId: pending.pendingAction.id, decision: "allow", pendingSendModel: f.model, getProvider: () => ({ capabilities: ["gmail.send"], execute: async (input) => { f.sent.push(input); return { messageId: "sent-1" }; } }), audit: async () => {} };
  assert.equal((await approvePendingSend({ ...args, userId: "u2" })).status, "not_found");
  assert.equal((await approvePendingSend({ ...args, conversationId: "chat-b" })).status, "not_found");
  const concurrent = await Promise.all([approvePendingSend(args), approvePendingSend(args)]);
  assert.equal(concurrent.filter((result) => result.status === "success").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "already_approved").length, 1);
  assert.equal((await approvePendingSend(args)).status, "already_completed");
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].payload.recipient, "paul@example.com");
  assert.equal(f.records.get(pending.pendingAction.id).status, "completed");
});

test("denied and expired pending actions never reach Gmail", async () => {
  const f = fixture();
  const pending = await f.executor({ user: { _id: "u1" }, conversationId: "chat-a", provider: "google", action: "gmail.send", payload: { recipient: "paul@example.com", body: "Hello" } });
  const args = { userId: "u1", conversationId: "chat-a", actionId: pending.pendingAction.id, pendingSendModel: f.model, getProvider: () => ({ capabilities: ["gmail.send"], execute: async (input) => { f.sent.push(input); } }), audit: async () => {} };
  assert.equal((await approvePendingSend({ ...args, decision: "deny" })).status, "denied");
  assert.equal(f.sent.length, 0);
  const expired = await f.executor({ user: { _id: "u1" }, conversationId: "chat-a", provider: "google", action: "gmail.send", payload: { recipient: "paul@example.com", body: "Again" } });
  f.records.get(expired.pendingAction.id).expiresAt = new Date(0);
  assert.equal((await approvePendingSend({ ...args, actionId: expired.pendingAction.id, decision: "allow" })).status, "expired");
  assert.equal(f.sent.length, 0);
});

test("edited server draft is the exact payload sent after approval", async () => {
  const f = fixture();
  const pending = await f.executor({ user: { _id: "u1" }, conversationId: "chat-a", provider: "google", action: "gmail.send", payload: { recipient: "alice@example.com", subject: "Hi", body: "Old" } });
  const updated = await editPendingSend({ userId: "u1", conversationId: "chat-a", actionId: pending.pendingAction.id, recipient: "newperson@example.com", subject: "Updated", body: "Latest", pendingSendModel: f.model });
  assert.equal(updated.status, "updated");
  const result = await approvePendingSend({ userId: "u1", conversationId: "chat-a", actionId: pending.pendingAction.id, decision: "allow", pendingSendModel: f.model, getProvider: () => ({ capabilities: ["gmail.send"], execute: async (input) => { f.sent.push(input); return { messageId: "sent-1" }; } }), audit: async () => {} });
  assert.equal(result.status, "success");
  assert.deepEqual(f.sent[0].payload, { recipient: "newperson@example.com", subject: "Updated", body: "Latest" });
});
