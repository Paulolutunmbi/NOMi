const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_ATTACHMENTS_COUNT,
  detectMimeTypeFromMagicBytes,
  sanitizeFilename,
  validateAttachment,
  validateAttachmentSet,
} = require("../src/services/attachments/attachmentValidator");
const {
  storeAttachment,
  getAttachment,
  getAttachmentsForUser,
  removeAttachments,
  clearAllForTesting,
} = require("../src/services/attachments/attachmentService");

// Minimal real image fixtures (magic bytes + a little padding so they clear
// the 12-byte magic-byte sniff window).
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("fake-png-body-data"),
]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("fake-jpeg-body-data")]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF", "ascii"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("WEBP", "ascii"),
  Buffer.from("fake-webp-body-data"),
]);
const GIF_BYTES = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.from("not-an-allowed-type")]);

const b64 = (buffer) => buffer.toString("base64");

test("magic-byte detection identifies PNG, JPEG, and WebP and rejects unknown formats", () => {
  assert.equal(detectMimeTypeFromMagicBytes(PNG_BYTES), "image/png");
  assert.equal(detectMimeTypeFromMagicBytes(JPEG_BYTES), "image/jpeg");
  assert.equal(detectMimeTypeFromMagicBytes(WEBP_BYTES), "image/webp");
  assert.equal(detectMimeTypeFromMagicBytes(GIF_BYTES), null);
  assert.equal(detectMimeTypeFromMagicBytes(Buffer.from([1, 2, 3])), null);
  assert.equal(detectMimeTypeFromMagicBytes("not a buffer"), null);
});

test("validateAttachment accepts PNG, JPEG, and WebP from base64 or data-URL strings", () => {
  const png = validateAttachment({ filename: "logo.png", mimeType: "image/png", data: b64(PNG_BYTES) });
  assert.equal(png.valid, true);
  assert.equal(png.mimeType, "image/png");
  assert.equal(png.filename, "logo.png");
  assert.equal(png.size, PNG_BYTES.length);
  assert.deepEqual(png.buffer, PNG_BYTES);

  const jpeg = validateAttachment({ filename: "photo.jpg", mimeType: "image/jpeg", data: `data:image/jpeg;base64,${b64(JPEG_BYTES)}` });
  assert.equal(jpeg.valid, true);
  assert.equal(jpeg.mimeType, "image/jpeg");

  const webp = validateAttachment({ filename: "sticker.webp", mimeType: "image/webp", data: b64(WEBP_BYTES) });
  assert.equal(webp.valid, true);
  assert.equal(webp.mimeType, "image/webp");

  // A Buffer passed directly (not a base64 string) is also accepted.
  const fromBuffer = validateAttachment({ filename: "raw.png", mimeType: "image/png", data: PNG_BYTES });
  assert.equal(fromBuffer.valid, true);
});

test("validateAttachment rejects unsupported MIME types even with a plausible extension", () => {
  const gif = validateAttachment({ filename: "animated.gif", mimeType: "image/gif", data: b64(GIF_BYTES) });
  assert.equal(gif.valid, false);
  assert.equal(gif.code, "attachment_unsupported_type");
});

test("validateAttachment does not trust the client-supplied MIME type over the real file content", () => {
  // Client claims PNG, but the bytes are actually JPEG — must be rejected, not silently relabeled.
  const spoofed = validateAttachment({ filename: "photo.png", mimeType: "image/png", data: b64(JPEG_BYTES) });
  assert.equal(spoofed.valid, false);
  assert.equal(spoofed.code, "attachment_mime_mismatch");
});

test("validateAttachment rejects missing, empty, malformed, and oversized data", () => {
  assert.equal(validateAttachment({ filename: "x.png", data: null }).valid, false);
  assert.equal(validateAttachment({ filename: "x.png", data: null }).code, "attachment_missing_data");

  assert.equal(validateAttachment({ filename: "x.png", data: Buffer.alloc(0) }).code, "attachment_empty");

  assert.equal(validateAttachment({ filename: "x.png", data: 12345 }).code, "attachment_invalid_data");

  const oversized = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_FILE_SIZE)]);
  const result = validateAttachment({ filename: "huge.png", data: oversized });
  assert.equal(result.valid, false);
  assert.equal(result.code, "attachment_too_large");
});

test("sanitizeFilename strips path traversal, null bytes, and control characters", () => {
  assert.equal(sanitizeFilename("../../etc/passwd.png", "image/png"), "passwd.png");
  assert.equal(sanitizeFilename("C:\\Users\\me\\evil.png", "image/png"), "evil.png");
  assert.equal(sanitizeFilename("bad\0name.png", "image/png"), "badname.png");
  assert.equal(sanitizeFilename("", "image/png"), "attachment.png");
  assert.equal(sanitizeFilename(".hidden", "image/webp"), "attachment.webp");
  assert.equal(sanitizeFilename(undefined, "image/jpeg"), "attachment.jpg");
  assert.equal(sanitizeFilename("a".repeat(300) + ".png", "image/png").length, 255);
});

test("validateAttachmentSet enforces per-file type/size rules plus a total-size and count ceiling", () => {
  const okSet = validateAttachmentSet([
    { filename: "a.png", data: b64(PNG_BYTES) },
    { filename: "b.jpg", data: b64(JPEG_BYTES) },
  ]);
  assert.equal(okSet.valid, true);
  assert.equal(okSet.attachments.length, 2);

  const tooMany = validateAttachmentSet(Array.from({ length: MAX_ATTACHMENTS_COUNT + 1 }, () => ({ filename: "a.png", data: b64(PNG_BYTES) })));
  assert.equal(tooMany.valid, false);
  assert.equal(tooMany.code, "too_many_attachments");

  // Each file stays just under the per-file cap, but three of them together
  // exceed the total-size cap (MAX_TOTAL_SIZE < 3 * MAX_FILE_SIZE).
  const bigChunk = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_FILE_SIZE - PNG_BYTES.length - 1024)]);
  const overTotal = validateAttachmentSet([
    { filename: "a.png", data: bigChunk },
    { filename: "b.png", data: bigChunk },
    { filename: "c.png", data: bigChunk },
  ]);
  assert.equal(overTotal.valid, false);
  assert.equal(overTotal.code, "total_attachment_size_exceeded");

  assert.equal(validateAttachmentSet("not-an-array").code, "invalid_attachments_format");
});

// --- attachmentService: staging, ownership, and cleanup ---

test.beforeEach(() => clearAllForTesting());

test("storeAttachment requires an authenticated user and returns metadata only, never the buffer", async () => {
  await assert.rejects(
    storeAttachment({ user: null, filename: "a.png", data: b64(PNG_BYTES) }),
    { code: "unauthenticated_attachment_upload" },
  );

  const user = { _id: "user-1" };
  const stored = await storeAttachment({ user, filename: "photo.png", mimeType: "image/png", data: b64(PNG_BYTES) });
  assert.equal(Object.hasOwn(stored, "data"), false);
  assert.equal(Object.hasOwn(stored, "buffer"), false);
  assert.equal(stored.filename, "photo.png");
  assert.equal(stored.mimeType, "image/png");
  assert.equal(stored.size, PNG_BYTES.length);
  assert.ok(stored.id);
});

test("storeAttachment rejects invalid uploads with the validator's structured error code", async () => {
  const user = { _id: "user-1" };
  await assert.rejects(
    storeAttachment({ user, filename: "bad.gif", mimeType: "image/gif", data: b64(GIF_BYTES) }),
    { code: "attachment_unsupported_type" },
  );
});

test("getAttachment and getAttachmentsForUser enforce per-user ownership", async () => {
  const owner = { _id: "owner-1" };
  const stranger = { _id: "stranger-1" };
  const stored = await storeAttachment({ user: owner, filename: "mine.png", data: b64(PNG_BYTES) });

  const ownFetch = await getAttachment({ user: owner, attachmentId: stored.id });
  assert.equal(ownFetch.filename, "mine.png");
  assert.deepEqual(ownFetch.buffer, PNG_BYTES);

  const strangerFetch = await getAttachment({ user: stranger, attachmentId: stored.id });
  assert.equal(strangerFetch, null);

  await assert.rejects(
    getAttachmentsForUser({ user: stranger, attachmentIds: [stored.id] }),
    { code: "attachment_not_found" },
  );

  const ownBatch = await getAttachmentsForUser({ user: owner, attachmentIds: [stored.id] });
  assert.equal(ownBatch.length, 1);
  assert.deepEqual(ownBatch[0].data, PNG_BYTES);
});

test("getAttachmentsForUser rejects a batch whose combined size exceeds the total cap", async () => {
  const user = { _id: "user-1" };
  const big = Buffer.concat([PNG_BYTES, Buffer.alloc(MAX_FILE_SIZE - PNG_BYTES.length - 1024)]);
  const a = await storeAttachment({ user, filename: "a.png", data: big });
  const b = await storeAttachment({ user, filename: "b.png", data: big });
  const c = await storeAttachment({ user, filename: "c.png", data: big });
  await assert.rejects(
    getAttachmentsForUser({ user, attachmentIds: [a.id, b.id, c.id] }),
    { code: "total_attachment_size_exceeded" },
  );
});

test("removeAttachments deletes only the requesting user's own attachments", async () => {
  const owner = { _id: "owner-1" };
  const stranger = { _id: "stranger-1" };
  const stored = await storeAttachment({ user: owner, filename: "mine.png", data: b64(PNG_BYTES) });

  await removeAttachments({ user: stranger, attachmentIds: [stored.id] });
  assert.ok(await getAttachment({ user: owner, attachmentId: stored.id }));

  await removeAttachments({ user: owner, attachmentIds: [stored.id] });
  assert.equal(await getAttachment({ user: owner, attachmentId: stored.id }), null);
});

test("expired staged attachments are purged and no longer resolvable", async () => {
  const user = { _id: "user-1" };
  const realNow = Date.now;
  try {
    const stored = await storeAttachment({ user, filename: "temp.png", data: b64(PNG_BYTES) });
    assert.ok(await getAttachment({ user, attachmentId: stored.id }));
    Date.now = () => realNow() + 3 * 60 * 60 * 1000; // fast-forward past the 2h TTL
    assert.equal(await getAttachment({ user, attachmentId: stored.id }), null);
  } finally {
    Date.now = realNow;
  }
});
