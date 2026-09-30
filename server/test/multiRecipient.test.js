const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIGateway } = require("../src/services/ai/aiGateway");
const { validateIntent } = require("../src/services/ai/intentValidator");
const { explicitlyRequestedRecipientPlaceholders, extractExplicitRecipientEmails } = require("../src/services/ai/intentSafetyPolicy");
const { prepareAIInput, restorePlaceholders } = require("../src/services/privacy/privacyService");
const { parseRecipientList, MAX_RECIPIENTS } = require("../src/services/validation/recipientList");
const { createActionExecutor, editPendingSend } = require("../src/services/actions/actionExecutor");
const { createGmailProvider } = require("../src/services/integrations/gmailProvider");
const { createAIActionRouter, explicitRecipientList } = require("../src/routes/aiActionRoutes");

const fullParams = (values = {}) => ({
  body: null, maxResults: null, messageId: null, query: null, recipient: null, subject: null,
  eventId: null, summary: null, description: null, location: null, startDateTime: null, endDateTime: null,
  timeZone: null, attendees: null, timeMin: null, timeMax: null, addMeet: null,
  ...values,
});

const TOLU = "toluibadandigital@gmail.com";
const OREO = "oreoluwapaul0110@gmail.com";
const USER_MESSAGE = `send a mail to ${TOLU} ,and ${OREO} tell them to resume work ASAP`;

// Runs a message through the same privacy -> gateway -> restore path the routes use.
const plan = async (message, modelOutput) => {
  const safe = prepareAIInput({ userRequest: message });
  const gateway = createAIGateway({ providerName: "groq", adapters: { groq: { generateIntent: async () => modelOutput(safe.mappings) } } });
  const result = await gateway.generateIntent({
    safeInput: safe.payload, placeholderMappings: safe.mappings, originalUserRequest: message,
    explicitRecipientEmail: extractExplicitRecipientEmails(message)[0] || null,
  });
  return { result, restored: result.status === "proposed" ? restorePlaceholders(result.intent, safe.mappings) : null };
};

test("the exact prompt that failed in the log now produces a two-recipient send proposal", async () => {
  const { result, restored } = await plan(USER_MESSAGE, () => ({
    action: "gmail.send",
    parameters: fullParams({ recipient: "[EMAIL_1], [EMAIL_2]", subject: "Please Resume Work ASAP", body: "Hello, please resume work as soon as possible. Thank you." }),
  }));
  assert.equal(result.status, "proposed", result.reason);
  assert.equal(restored.action, "gmail.send");
  assert.equal(restored.parameters.recipient, `${TOLU}, ${OREO}`);
});

test("a list phrased with & or plain commas is also accepted", async () => {
  const message = "email a@example.com, b@example.com & c@example.com about lunch";
  const { result } = await plan(message, () => ({ action: "gmail.draft", parameters: fullParams({ recipient: "[EMAIL_1], [EMAIL_2], [EMAIL_3]", subject: "Lunch", body: "Lunch?" }) }));
  assert.equal(result.status, "proposed", result.reason);
});

test("the model cannot add a recipient the user never typed", async () => {
  // The validator itself rejects the extra address with the same reason a single mismatch always had...
  const direct = validateIntent({ action: "gmail.send", parameters: fullParams({ recipient: `${TOLU}, stranger@evil.example`, subject: "Hi", body: "hi" }) }, { explicitRecipientEmails: [TOLU] });
  assert.deepEqual(direct, { valid: false, reason: "explicit_recipient_mismatch" });
  // ...and end to end, NOMI never proposes a send that includes it (the gateway's existing
  // fallback for a bad target is a clarification question).
  const { result } = await plan(`send a mail to ${TOLU} saying hi`, () => ({
    action: "gmail.send", parameters: fullParams({ recipient: "[EMAIL_1], stranger@evil.example", subject: "Hi", body: "hi" }),
  }));
  assert.notEqual(result.intent?.action, "gmail.send");
  assert.equal(result.intent?.action, "clarification");
  assert.equal(JSON.stringify(result).includes("stranger@evil.example"), false);
});

test("an address that only appears in retrieved mail is never trusted as a list member", () => {
  const mappings = { "[EMAIL_1]": { type: "EMAIL", value: "a@example.com" }, "[EMAIL_2]": { type: "EMAIL", value: "b@example.com" } };
  // [EMAIL_2] is not in the user's request text, so it cannot be promoted.
  assert.deepEqual(explicitlyRequestedRecipientPlaceholders("send a mail to [EMAIL_1] saying hi", mappings), ["[EMAIL_1]"]);
  // Chained only through the user's own list wording, and never without a directly requested anchor.
  assert.deepEqual(explicitlyRequestedRecipientPlaceholders("[EMAIL_1] and [EMAIL_2] are my friends", mappings), []);
});

test("a self marker can be one entry in a list, and a list cannot exceed the cap", () => {
  const ok = validateIntent({ action: "gmail.send", parameters: fullParams({ recipient: "me, a@example.com", subject: "s", body: "b" }) }, { explicitRecipientEmails: ["a@example.com"] });
  assert.equal(ok.valid, true);
  const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@example.com`);
  const tooMany = validateIntent({ action: "gmail.send", parameters: fullParams({ recipient: many.join(", "), subject: "s", body: "b" }) }, { explicitRecipientEmails: many });
  assert.deepEqual(tooMany, { valid: false, reason: "too_many_recipients" });
});

test("a single recipient behaves exactly as before, including the old failure reasons", () => {
  const params = (recipient) => fullParams({ recipient, subject: "s", body: "b" });
  assert.equal(validateIntent({ action: "gmail.send", parameters: params("a@example.com") }, { explicitRecipientEmails: ["a@example.com"] }).valid, true);
  assert.equal(validateIntent({ action: "gmail.send", parameters: params("Paul") }).reason, "unresolved_recipient");
  assert.equal(validateIntent({ action: "gmail.send", parameters: params("x@example.com") }, { explicitRecipientEmails: ["a@example.com"] }).reason, "explicit_recipient_mismatch");
  assert.equal(validateIntent({ action: "gmail.send", parameters: params("x@example.com") }).reason, "untrusted_recipient_email");
});

test("recipient list parsing normalises, de-duplicates and rejects any bad entry", () => {
  assert.deepEqual(parseRecipientList("A@x.com, b@y.com; a@x.com"), { ok: true, recipients: ["a@x.com", "b@y.com"] });
  assert.equal(parseRecipientList("a@x.com, not-an-email").ok, false);
  assert.equal(parseRecipientList("").ok, false);
  assert.equal(parseRecipientList("a@x.com\r\nBcc: evil@x.com").ok, false);
});

test("the action route keeps every typed address instead of only the first", () => {
  assert.equal(explicitRecipientList(USER_MESSAGE), `${TOLU}, ${OREO}`);
  assert.equal(explicitRecipientList("Send it to <PAUL@example.com>"), "paul@example.com");
  assert.equal(explicitRecipientList("Draft a note to Paul"), null);
  assert.equal(typeof createAIActionRouter, "function");
});

const pendingFixture = () => {
  const records = new Map();
  const model = {
    async create(value) { const record = { ...value, _id: "000000000000000000000001" }; records.set(String(record._id), record); return record; },
    findOneAndUpdate(filter, update) {
      const row = records.get(String(filter._id));
      if (!row) return null;
      row.payload = { ...row.payload, recipient: update.$set["payload.recipient"], subject: update.$set["payload.subject"], body: update.$set["payload.body"] };
      return { lean: async () => ({ ...row }) };
    },
  };
  const executor = createActionExecutor({ pendingSendModel: model, check: async () => ({ allowed: true }), getProvider: () => ({ capabilities: ["gmail.send"], execute: async () => ({}) }), audit: async () => {} });
  return { model, executor };
};

test("send approval shows and stores all recipients; one bad address rejects the whole send", async () => {
  const { executor } = pendingFixture();
  const good = await executor({ user: { _id: "u1" }, conversationId: "c1", provider: "google", action: "gmail.send", payload: { recipient: `${TOLU.toUpperCase()}, ${OREO}`, subject: "s", body: "b" } });
  assert.equal(good.status, "approval_required");
  assert.equal(good.pendingAction.recipient, `${TOLU}, ${OREO}`);
  const bad = await executor({ user: { _id: "u1" }, conversationId: "c1", provider: "google", action: "gmail.send", payload: { recipient: `${TOLU}, nope`, subject: "s", body: "b" } });
  assert.deepEqual(bad, { status: "rejected", reason: "invalid_recipient" });
});

test("editing the pending card accepts a recipient list and rejects a malformed one", async () => {
  const { model, executor } = pendingFixture();
  const created = await executor({ user: { _id: "u1" }, conversationId: "c1", provider: "google", action: "gmail.send", payload: { recipient: TOLU, subject: "s", body: "b" } });
  const id = created.pendingAction.id;
  const updated = await editPendingSend({ userId: "u1", conversationId: "c1", actionId: id, recipient: `${TOLU}, ${OREO}`, subject: "s2", body: "b2", pendingSendModel: model, now: () => new Date(0) });
  assert.equal(updated.status, "updated");
  assert.equal(updated.pendingAction.recipient, `${TOLU}, ${OREO}`);
  const invalid = await editPendingSend({ userId: "u1", conversationId: "c1", actionId: id, recipient: `${TOLU}, bad`, subject: "s2", body: "b2", pendingSendModel: model });
  assert.deepEqual(invalid, { status: "invalid" });
});

test("gmail provider writes one To header listing every recipient and refuses injected headers", async () => {
  const sentRaw = [];
  const api = { users: { messages: { send: async (input) => { sentRaw.push(Buffer.from(input.requestBody.raw, "base64url").toString("utf8")); return { data: { id: "s1", threadId: "t1" } }; } }, drafts: { create: async () => ({ data: { id: "d", message: { id: "m" } } }) } } };
  const provider = createGmailProvider({ gmailFactory: () => api });
  await provider.execute({}, "gmail.send", { recipient: `${TOLU}, ${OREO}`, subject: "Please Resume Work ASAP", body: "Please resume work." });
  assert.match(sentRaw[0], new RegExp(`^To: ${TOLU}, ${OREO}\\r\\nSubject: Please Resume Work ASAP\\r\\n`));
  await assert.rejects(() => provider.execute({}, "gmail.send", { recipient: `${TOLU}\r\nBcc: evil@example.com`, subject: "s", body: "b" }), /valid recipient/i);
  assert.equal(sentRaw.length, 1);
});

// ---- orchestrator execution boundary ----
const { createActionOrchestrator: createOrchestratorReal } = require("../src/services/actions/actionOrchestrator");
const contextFixture = () => { const record = { gmailMessageIds: [], gmailCandidates: [], retrievedContext: [] }; return { getActive: async () => record, create: async () => record, update: async (values) => { Object.assign(record, values); return record; } }; };
const orchestratorFor = (calls, checkEmailDomain = async () => ({ status: "ok" })) => createOrchestratorReal({
  contextService: contextFixture(), checkEmailDomain,
  actionExecutor: async (input) => { calls.push(input); return { status: "approval_required" }; },
});
const sendProposal = (recipient) => ({ action: "gmail.send", parameters: fullParams({ recipient, subject: "Please Resume Work ASAP", body: "Please resume work." }) });

test("orchestrator hands the executor every recipient when each one appears in the user's message", async () => {
  const calls = [];
  const outcome = await orchestratorFor(calls).execute({ user: { _id: "u1", email: "me@example.com" }, conversationId: "c", message: USER_MESSAGE, proposal: sendProposal(`${TOLU}, ${OREO}`) });
  assert.equal(outcome.status, "approval_required");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.recipient, `${TOLU}, ${OREO}`);
});

test("orchestrator rejects the whole send when any one recipient was not typed by the user", async () => {
  const calls = [];
  const outcome = await orchestratorFor(calls).execute({ user: { _id: "u1" }, conversationId: "c", message: `send a mail to ${TOLU} saying hi`, proposal: sendProposal(`${TOLU}, ${OREO}`) });
  assert.deepEqual(outcome, { status: "rejected", reason: "untrusted_recipient_email" });
  assert.equal(calls.length, 0);
});

test("orchestrator resolves the self marker inside a list and checks the domain of every external recipient", async () => {
  const calls = [];
  const checked = [];
  const orchestrator = orchestratorFor(calls, async (address) => { checked.push(address); return address === OREO ? { status: "no_mail_server", domain: "gmail.com" } : { status: "ok" }; });
  const outcome = await orchestrator.execute({ user: { _id: "u1", email: "Me@Example.com" }, conversationId: "c", message: `send a mail to me and ${TOLU} and ${OREO}`, proposal: sendProposal(`me, ${TOLU}, ${OREO}`) });
  assert.equal(outcome.status, "email_domain_warning");
  assert.deepEqual(checked, [TOLU, OREO]); // self is never domain-checked
  assert.equal(calls.length, 0);          // nothing is staged for approval
  const calls2 = [];
  const ok = await orchestratorFor(calls2).execute({ user: { _id: "u1", email: "Me@Example.com" }, conversationId: "c", message: `send a mail to me and ${TOLU}`, proposal: sendProposal(`me, ${TOLU}`) });
  assert.equal(ok.status, "approval_required");
  assert.equal(calls2[0].payload.recipient, `me@example.com, ${TOLU}`);
});

test("a model that joins recipients with 'and' instead of a comma still yields a valid list", async () => {
  const { result, restored } = await plan(USER_MESSAGE, () => ({
    action: "gmail.send", parameters: fullParams({ recipient: "[EMAIL_1] and [EMAIL_2]", subject: "Please Resume Work ASAP", body: "Please resume work." }),
  }));
  assert.equal(result.status, "proposed", result.reason);
  assert.equal(restored.parameters.recipient, `${TOLU}, ${OREO}`);
});
