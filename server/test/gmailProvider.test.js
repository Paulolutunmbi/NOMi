const test = require("node:test");
const assert = require("node:assert/strict");
const { createGmailProvider, MAX_BODY_LENGTH } = require("../src/services/integrations/gmailProvider");
const { createGoogleIntegration } = require("../src/services/integrations/googleIntegration");

const b64 = (value) => Buffer.from(value, "utf8").toString("base64url");
const message = (id = "m1", overrides = {}) => ({
  id, threadId: "t1", snippet: "A short preview", payload: { headers: [
    { name: "From", value: "Aminat Bello <aminat@example.com>" }, { name: "To", value: "me@example.com" },
    { name: "Subject", value: "Project update" }, { name: "Date", value: "Mon, 1 Jan 2026 12:00:00 +0000" },
    { name: "Message-ID", value: "<original@example.com>" }, { name: "References", value: "<prior@example.com>" },
  ], mimeType: "text/plain", body: { data: b64("Private plain-text message") } }, ...overrides });
const fakeGmail = () => {
  const calls = { list: [], get: [], draft: [], send: [] };
  const api = { users: { messages: {
    list: async (input) => { calls.list.push(input); return { data: { messages: [{ id: "m1" }] } }; },
    get: async (input) => { calls.get.push(input); return { data: message(input.id) }; },
    send: async (input) => { calls.send.push(input); return { data: { id: "sent1", threadId: input.requestBody.threadId || "new-thread" } }; },
  }, drafts: {
    create: async (input) => { calls.draft.push(input); return { data: { id: "draft1", message: { id: "dm1", threadId: input.requestBody.message.threadId || "new-thread" } } }; },
    update: async (input) => { calls.draft.push(input); return { data: { id: input.id, message: { id: "dm1", threadId: input.requestBody.message.threadId || "existing-thread" } } }; },
  } } };
  return { api, calls };
};
const providerFor = (fake) => createGmailProvider({ gmailFactory: () => fake.api });
const raw = (input) => Buffer.from(input.requestBody.message?.raw || input.requestBody.raw, "base64url").toString("utf8");

test("gmail.search returns normalized, MIME-free messages and bounds results", async () => {
  const fake = fakeGmail();
  const result = await providerFor(fake).execute({}, "gmail.search", { query: "from:aminat", maxResults: 999 });
  assert.equal(fake.calls.list[0].maxResults, 50);
  assert.deepEqual(Object.keys(result.messages[0]).sort(), ["date", "from", "id", "recipient", "sender", "snippet", "subject", "threadId"].sort());
  assert.deepEqual(result.messages[0].from, { name: "Aminat Bello", email: "aminat@example.com" });
  assert.equal(fake.calls.list[0].q, "from:aminat");
  assert.equal(JSON.stringify(result).includes("payload"), false);
  assert.equal(JSON.stringify(result).includes("Private plain-text"), false);
});

test("gmail.read keeps the original raw sender header and now also exposes a parsed from{name,email}, matching gmail.search", async () => {
  const fake = fakeGmail();
  const read = await providerFor(fake).execute({}, "gmail.read", { messageId: "m1" });
  assert.equal(read.message.sender, "Aminat Bello <aminat@example.com>");
  assert.deepEqual(read.message.from, { name: "Aminat Bello", email: "aminat@example.com" });
});

test("gmail.read returns bounded normalized content and rejects missing IDs", async () => {
  const fake = fakeGmail();
  const read = await providerFor(fake).execute({}, "gmail.read", { messageId: "m1" });
  assert.equal(read.message.body, "Private plain-text message");
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.read", {}), { code: "gmail_invalid_request" });
  const oversized = message("m2", { payload: { headers: [], mimeType: "text/plain", body: { data: b64("x".repeat(MAX_BODY_LENGTH + 20)) } } });
  fake.api.users.messages.get = async () => ({ data: oversized });
  const bounded = await providerFor(fake).execute({}, "gmail.read", { messageId: "m2" });
  assert.equal(bounded.message.body.length, MAX_BODY_LENGTH);
});

test("draft and send construct UTF-8 plain-text MIME without exposing secrets", async () => {
  const fake = fakeGmail(); const provider = providerFor(fake);
  const draft = await provider.execute({}, "gmail.draft", { recipient: "to@example.com", subject: "Résumé", body: "Hello\nworld" });
  const sent = await provider.execute({}, "gmail.send", { recipient: "to@example.com", subject: "Hi", body: "Hello" });
  assert.match(raw(fake.calls.draft[0]), /To: to@example.com\r\nSubject: =\?UTF-8\?B\?.+\?=\r\n/);
  assert.match(raw(fake.calls.draft[0]), /Content-Type: text\/plain; charset=UTF-8/);
  assert.equal(draft.draftId, "draft1"); assert.equal(sent.messageId, "sent1");
  assert.equal(/token|secret|authorization/i.test(JSON.stringify({ draft, sent })), false);
});

test("reply actions use Gmail target metadata and never accept an AI recipient", async () => {
  const fake = fakeGmail(); const provider = providerFor(fake);
  const draft = await provider.execute({}, "gmail.draft.reply", { messageId: "m1", body: "Thanks", recipient: "evil@example.com" });
  const sent = await provider.execute({}, "gmail.send.reply", { messageId: "m1", body: "Thanks", recipient: "evil@example.com" });
  const draftRaw = raw(fake.calls.draft[0]); const sentRaw = raw(fake.calls.send[0]);
  assert.match(draftRaw, /To: aminat@example.com/); assert.doesNotMatch(draftRaw, /evil@example.com/);
  assert.match(draftRaw, /In-Reply-To: <original@example.com>/); assert.match(sentRaw, /References: <prior@example.com> <original@example.com>/);
  assert.equal(fake.calls.draft[0].requestBody.message.threadId, "t1"); assert.equal(sent.threadId, "t1"); assert.equal(draft.draftId, "draft1");
});

test("gmail.draft.update revises a new-message draft using server-trusted recipient/subject, not caller-supplied thread", async () => {
  const fake = fakeGmail(); const provider = providerFor(fake);
  const updated = await provider.execute({}, "gmail.draft.update", { draftId: "draft1", recipient: "to@example.com", subject: "Hi", body: "Revised casual body", threadId: "thread-1" });
  assert.equal(fake.calls.draft[0].id, "draft1");
  assert.match(raw(fake.calls.draft[0]), /To: to@example.com/);
  assert.match(raw(fake.calls.draft[0]), /Revised casual body/);
  assert.equal(updated.draftId, "draft1");
});

test("gmail.draft.update on a reply draft rebuilds thread/reply headers from the trusted original message, ignoring any caller-supplied subject", async () => {
  const fake = fakeGmail(); const provider = providerFor(fake);
  const updated = await provider.execute({}, "gmail.draft.update", { draftId: "draft1", body: "More casual now", replyToMessageId: "m1" });
  const draftRaw = raw(fake.calls.draft[0]);
  assert.match(draftRaw, /To: aminat@example.com/);
  assert.match(draftRaw, /In-Reply-To: <original@example.com>/);
  assert.match(draftRaw, /More casual now/);
  assert.equal(fake.calls.draft[0].requestBody.message.threadId, "t1");
  assert.equal(updated.threadId, "t1");
});

test("gmail.draft.update rejects without a draftId or a valid body", async () => {
  const fake = fakeGmail(); const provider = providerFor(fake);
  await assert.rejects(() => provider.execute({}, "gmail.draft.update", { body: "x" }), { code: "gmail_invalid_request" });
  await assert.rejects(() => provider.execute({}, "gmail.draft.update", { draftId: "draft1" }), { code: "gmail_invalid_request" });
});

test("Gmail and credential failures have safe predictable codes", async () => {
  const fake = fakeGmail(); fake.api.users.messages.get = async () => { const error = new Error("not found"); error.code = 404; throw error; };
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.read", { messageId: "gone" }), { code: "gmail_message_not_found" });
  fake.api.users.messages.list = async () => { const error = new Error("quota"); error.code = 429; throw error; };
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.search", { query: "x" }), { code: "google_rate_limited" });
  const integration = createGoogleIntegration({ credentialService: { getGoogleAuthForUser: async () => { const error = new Error("not connected"); error.code = "google_not_connected"; throw error; }, refreshGoogleAccessToken: async () => {} }, gmailProvider: providerFor(fake) });
  await assert.rejects(() => integration.execute({ user: { _id: "u1" }, action: "gmail.search", payload: { query: "x" } }), { code: "google_not_connected" });
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.delete", {}), { code: "gmail_invalid_request" });
});

test("gmail.markRead batch-removes UNREAD from every provided ID, deduplicated and capped", async () => {
  const calls = { batchModify: [] };
  const api = { users: { messages: {
    batchModify: async (input) => { calls.batchModify.push(input); return {}; },
  } } };
  const provider = createGmailProvider({ gmailFactory: () => api });
  const ids = ["m1", "m2", "m1", ...Array.from({ length: 60 }, (_, i) => `extra-${i}`)];
  const result = await provider.execute({}, "gmail.markRead", { messageIds: ids });
  assert.equal(calls.batchModify[0].requestBody.removeLabelIds[0], "UNREAD");
  assert.equal(calls.batchModify[0].requestBody.ids.length, 50);
  assert.equal(calls.batchModify[0].requestBody.ids.filter((id) => id === "m1").length, 1);
  assert.equal(result.markedRead, 50);
});

test("gmail.markRead rejects when no valid message IDs are provided", async () => {
  const api = { users: { messages: { batchModify: async () => { throw new Error("should not be called"); } } } };
  const provider = createGmailProvider({ gmailFactory: () => api });
  await assert.rejects(provider.execute({}, "gmail.markRead", { messageIds: [] }), (error) => error.code === "gmail_invalid_request");
});
