const test = require("node:test");
const assert = require("node:assert/strict");
const { createConversationContextService, normalizeTrustedDraft } = require("../src/services/conversations/conversationContextService");

test("normalizeTrustedDraft strips raw attachment bytes even if a caller passes them", () => {
  const raw = Buffer.from("some-raw-image-bytes");
  const normalized = normalizeTrustedDraft({
    draftId: "d1", action: "gmail.draft", recipient: "to@example.com",
    attachments: [{ id: "att-1", filename: "photo.png", mimeType: "image/png", size: raw.length, data: raw, buffer: raw }],
  });
  assert.equal(normalized.attachments.length, 1);
  assert.deepEqual(Object.keys(normalized.attachments[0]).sort(), ["filename", "id", "mimeType", "size"]);
  assert.equal(Object.hasOwn(normalized.attachments[0], "data"), false);
  assert.equal(Object.hasOwn(normalized.attachments[0], "buffer"), false);
});

test("temporary context expires and cannot be reused", async () => {
  let clock = new Date("2026-01-01T00:00:00Z");
  const records = [];
  const match = (filter, record) => record.conversationId === filter.conversationId && record.user === filter.user && (!filter.expiresAt || record.expiresAt > filter.expiresAt.$gt);
  const model = {
    create: async (record) => { records.push(record); return record; },
    findOne: async (filter) => records.find((record) => match(filter, record)) || null,
    findOneAndUpdate: async (filter, update) => { const record = records.find((item) => match(filter, item)); if (!record) return null; Object.assign(record, update.$set); return record; },
    deleteMany: async (filter) => { const before = records.length; for (let i = records.length - 1; i >= 0; i -= 1) if (records[i].expiresAt <= filter.expiresAt.$lte) records.splice(i, 1); return { deletedCount: before - records.length }; },
  };
  const service = createConversationContextService(model, { ttlMs: 1000, now: () => clock });
  const context = await service.create({ userId: "u1", conversationId: "c1" });
  assert.equal(context.expiresAt.getTime(), clock.getTime() + 1000);
  const updated = await service.update({ userId: "u1", conversationId: "c1", messages: [{ content: "[EMAIL_1]" }], placeholderMappings: { "[EMAIL_1]": { value: "a@b.com" } } });
  assert.equal(updated.messages.length, 1);
  clock = new Date(clock.getTime() + 1001);
  assert.equal(await service.getActive({ userId: "u1", conversationId: "c1" }), null);
  assert.equal(await service.update({ userId: "u1", conversationId: "c1", messages: [] }), null);
  assert.equal((await service.cleanupExpired()).deletedCount, 1);
});
