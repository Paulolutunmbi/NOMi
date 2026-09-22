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
  }, drafts: { create: async (input) => { calls.draft.push(input); return { data: { id: "draft1", message: { id: "dm1", threadId: input.requestBody.message.threadId || "new-thread" } } }; } } } };
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

test("gmail.read sender parsing remains the original raw header value", async () => {
  const fake = fakeGmail();
  const read = await providerFor(fake).execute({}, "gmail.read", { messageId: "m1" });
  assert.equal(read.message.sender, "Aminat Bello <aminat@example.com>");
  assert.equal(Object.hasOwn(read.message, "from"), false);
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

test("Gmail and credential failures have safe predictable codes", async () => {
  const fake = fakeGmail(); fake.api.users.messages.get = async () => { const error = new Error("not found"); error.code = 404; throw error; };
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.read", { messageId: "gone" }), { code: "gmail_message_not_found" });
  fake.api.users.messages.list = async () => { const error = new Error("quota"); error.code = 429; throw error; };
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.search", { query: "x" }), { code: "google_rate_limited" });
  const integration = createGoogleIntegration({ credentialService: { getGoogleAuthForUser: async () => { const error = new Error("not connected"); error.code = "google_not_connected"; throw error; }, refreshGoogleAccessToken: async () => {} }, gmailProvider: providerFor(fake) });
  await assert.rejects(() => integration.execute({ user: { _id: "u1" }, action: "gmail.search", payload: { query: "x" } }), { code: "google_not_connected" });
  await assert.rejects(() => providerFor(fake).execute({}, "gmail.delete", {}), { code: "gmail_invalid_request" });
});
