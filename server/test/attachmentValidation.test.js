"use strict";

const { describe, it, before, afterEach, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_ATTACHMENTS_COUNT,
  ALLOWED_MIME_TYPES,
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
const AttachmentReference = require("../src/models/AttachmentReference");
const { cloudinaryUpload } = require("../src/services/attachments/attachmentService");

// ─── Minimal valid image buffers ──────────────────────────────────────────────
// 12-byte PNG magic header followed by padding zeros
const PNG_MAGIC = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
]);
// JPEG magic header
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
// WebP magic header: RIFF????WEBP
const WEBP_MAGIC = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // file size (placeholder)
  0x57, 0x45, 0x42, 0x50, // WEBP
]);

const toDataUrl = (buffer, mime) =>
  `data:${mime};base64,${buffer.toString("base64")}`;

const FAKE_USER = { _id: "user-001" };
const OTHER_USER = { _id: "user-002" };

// ─── Magic-byte detection ─────────────────────────────────────────────────────
describe("detectMimeTypeFromMagicBytes", () => {
  it("detects PNG", () => {
    assert.equal(detectMimeTypeFromMagicBytes(PNG_MAGIC), "image/png");
  });

  it("detects JPEG", () => {
    assert.equal(detectMimeTypeFromMagicBytes(JPEG_MAGIC), "image/jpeg");
  });

  it("detects WebP", () => {
    assert.equal(detectMimeTypeFromMagicBytes(WEBP_MAGIC), "image/webp");
  });

  it("returns null for unknown magic bytes", () => {
    const buf = Buffer.alloc(16, 0x00);
    assert.equal(detectMimeTypeFromMagicBytes(buf), null);
  });

  it("returns null for buffers shorter than 12 bytes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    assert.equal(detectMimeTypeFromMagicBytes(buf), null);
  });

  it("returns null for non-Buffer input", () => {
    assert.equal(detectMimeTypeFromMagicBytes("not a buffer"), null);
    assert.equal(detectMimeTypeFromMagicBytes(null), null);
  });
});

// ─── Filename sanitisation ────────────────────────────────────────────────────
describe("sanitizeFilename", () => {
  it("passes through a clean filename unchanged", () => {
    assert.equal(sanitizeFilename("photo.png", "image/png"), "photo.png");
  });

  it("strips path traversal components", () => {
    const result = sanitizeFilename("../../etc/passwd.png", "image/png");
    assert.doesNotMatch(result, /\.\./);
    assert.doesNotMatch(result, /\//);
  });

  it("strips null bytes", () => {
    const result = sanitizeFilename("photo\x00.png", "image/png");
    assert.doesNotMatch(result, /\x00/);
  });

  it("uses default extension for blank filename", () => {
    assert.equal(sanitizeFilename("", "image/png"), "attachment.png");
    assert.equal(sanitizeFilename("  ", "image/jpeg"), "attachment.jpg");
  });

  it("uses default name for dot-only filename", () => {
    const result = sanitizeFilename("...", "image/webp");
    assert.ok(result.startsWith("attachment"));
  });

  it("truncates to 255 characters", () => {
    const long = "a".repeat(300) + ".png";
    assert.ok(sanitizeFilename(long, "image/png").length <= 255);
  });
});

// ─── validateAttachment ───────────────────────────────────────────────────────
describe("validateAttachment", () => {
  it("accepts a valid PNG buffer", () => {
    const result = validateAttachment({ filename: "test.png", mimeType: "image/png", data: PNG_MAGIC });
    assert.equal(result.valid, true);
    assert.equal(result.mimeType, "image/png");
  });

  it("accepts a valid PNG as data URL", () => {
    const result = validateAttachment({ filename: "test.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });
    assert.equal(result.valid, true);
    assert.equal(result.mimeType, "image/png");
  });

  it("accepts a valid JPEG buffer", () => {
    const result = validateAttachment({ filename: "photo.jpg", mimeType: "image/jpeg", data: JPEG_MAGIC });
    assert.equal(result.valid, true);
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("accepts image/jpg (alias) as MIME type for JPEG magic bytes", () => {
    const result = validateAttachment({ filename: "photo.jpg", mimeType: "image/jpg", data: JPEG_MAGIC });
    assert.equal(result.valid, true);
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("accepts a valid WebP buffer", () => {
    const result = validateAttachment({ filename: "image.webp", mimeType: "image/webp", data: WEBP_MAGIC });
    assert.equal(result.valid, true);
    assert.equal(result.mimeType, "image/webp");
  });

  it("rejects missing data", () => {
    const result = validateAttachment({ filename: "test.png", mimeType: "image/png", data: null });
    assert.equal(result.valid, false);
    assert.ok(result.code.startsWith("attachment_"));
  });

  it("rejects empty buffer", () => {
    const result = validateAttachment({ filename: "test.png", mimeType: "image/png", data: Buffer.alloc(0) });
    assert.equal(result.valid, false);
    assert.equal(result.code, "attachment_empty");
  });

  it("rejects unsupported file type (GIF magic bytes)", () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
    const result = validateAttachment({ filename: "image.gif", mimeType: "image/gif", data: gif });
    assert.equal(result.valid, false);
    assert.equal(result.code, "attachment_unsupported_type");
  });

  it("rejects oversized file", () => {
    const huge = Buffer.alloc(MAX_FILE_SIZE + 1, 0x00);
    // Prepend PNG magic so it passes format detection if size check comes after
    PNG_MAGIC.copy(huge, 0);
    const result = validateAttachment({ filename: "huge.png", mimeType: "image/png", data: huge });
    assert.equal(result.valid, false);
    assert.equal(result.code, "attachment_too_large");
  });

  it("rejects MIME mismatch: claims PNG but has JPEG bytes", () => {
    const result = validateAttachment({ filename: "fake.png", mimeType: "image/png", data: JPEG_MAGIC });
    assert.equal(result.valid, false);
    assert.equal(result.code, "attachment_mime_mismatch");
  });

  it("accepts when client sends no MIME type (detected from magic bytes)", () => {
    const result = validateAttachment({ filename: "photo.jpg", data: JPEG_MAGIC });
    assert.equal(result.valid, true);
    assert.equal(result.mimeType, "image/jpeg");
  });

  it("sanitizes the returned filename", () => {
    const result = validateAttachment({ filename: "../../../etc/shadow", mimeType: "image/png", data: PNG_MAGIC });
    assert.equal(result.valid, true);
    assert.doesNotMatch(result.filename, /\.\./);
  });

  it("rejects invalid base64 encoding", () => {
    const result = validateAttachment({ filename: "test.png", mimeType: "image/png", data: "data:image/png;base64,NOT_BASE64!!!" });
    // May decode to garbled bytes — should fail magic or size check
    assert.equal(result.valid, false);
  });
});

// ─── validateAttachmentSet ────────────────────────────────────────────────────
describe("validateAttachmentSet", () => {
  it("accepts a valid set of attachments", () => {
    const result = validateAttachmentSet([
      { filename: "a.png", mimeType: "image/png", data: PNG_MAGIC },
      { filename: "b.jpg", mimeType: "image/jpeg", data: JPEG_MAGIC },
    ]);
    assert.equal(result.valid, true);
    assert.equal(result.attachments.length, 2);
  });

  it("rejects more than MAX_ATTACHMENTS_COUNT files", () => {
    const items = Array.from({ length: MAX_ATTACHMENTS_COUNT + 1 }, (_, i) => ({
      filename: `a${i}.png`, mimeType: "image/png", data: PNG_MAGIC,
    }));
    const result = validateAttachmentSet(items);
    assert.equal(result.valid, false);
    assert.equal(result.code, "too_many_attachments");
  });

  it("rejects a set that exceeds MAX_TOTAL_SIZE", () => {
    // Three individually valid files exceed the aggregate limit. Two files
    // cannot reach 25 MB while respecting the 10 MB per-file limit.
    const perFile = Math.floor(MAX_TOTAL_SIZE / 3) + 1;
    const bigPng = Buffer.alloc(perFile, 0x00);
    PNG_MAGIC.copy(bigPng, 0);
    const result = validateAttachmentSet([1, 2, 3].map((n) => ({
      filename: `big${n}.png`, mimeType: "image/png", data: bigPng,
    })));
    assert.equal(result.valid, false);
    assert.equal(result.code, "total_attachment_size_exceeded");
  });

  it("accepts an empty array", () => {
    const result = validateAttachmentSet([]);
    assert.equal(result.valid, true);
    assert.equal(result.attachments.length, 0);
  });

  it("rejects non-array input", () => {
    const result = validateAttachmentSet("not an array");
    assert.equal(result.valid, false);
  });

  it("fails fast on the first invalid attachment", () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
    const result = validateAttachmentSet([
      { filename: "ok.png", mimeType: "image/png", data: PNG_MAGIC },
      { filename: "bad.gif", mimeType: "image/gif", data: gif },
    ]);
    assert.equal(result.valid, false);
  });
});

// ─── attachmentService ────────────────────────────────────────────────────────
describe("attachmentService", () => {
  afterEach(() => clearAllForTesting());

  it("stores and retrieves an attachment for the correct user", async () => {
    const stored = await storeAttachment({
      user: FAKE_USER,
      filename: "test.png",
      mimeType: "image/png",
      data: toDataUrl(PNG_MAGIC, "image/png"),
    });

    assert.ok(typeof stored.id === "string" && stored.id.length > 0, "returned id must be a non-empty string");
    assert.equal(stored.filename, "test.png");
    assert.equal(stored.mimeType, "image/png");
    assert.ok(stored.size > 0);
    assert.equal(stored.buffer, undefined, "storeAttachment must not return raw buffer bytes");

    const retrieved = await getAttachment({ user: FAKE_USER, attachmentId: stored.id });
    assert.ok(retrieved, "should be retrievable by its owner");
    assert.equal(retrieved.mimeType, "image/png");
    assert.ok(Buffer.isBuffer(retrieved.buffer), "buffer is available for internal use");
  });

  it("returns null when another user requests an attachment", async () => {
    const stored = await storeAttachment({
      user: FAKE_USER,
      filename: "secret.png",
      mimeType: "image/png",
      data: toDataUrl(PNG_MAGIC, "image/png"),
    });

    const result = await getAttachment({ user: OTHER_USER, attachmentId: stored.id });
    assert.equal(result, null, "cross-user access must be denied");
  });

  it("rejects an expired staged attachment", async () => {
    const realNow = Date.now;
    let now = realNow();
    Date.now = () => now;
    try {
      const stored = await storeAttachment({ user: FAKE_USER, filename: "old.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });
      now += 3 * 60 * 60 * 1000;
      assert.equal(await getAttachment({ user: FAKE_USER, attachmentId: stored.id }), null);
      await assert.rejects(() => getAttachmentsForUser({ user: FAKE_USER, attachmentIds: [stored.id] }), { code: "attachment_not_found" });
    } finally { Date.now = realNow; }
  });

  it("getAttachmentsForUser returns resolved attachments with buffer for internal use", async () => {
    const a = await storeAttachment({ user: FAKE_USER, filename: "a.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });
    const b = await storeAttachment({ user: FAKE_USER, filename: "b.jpg", mimeType: "image/jpeg", data: toDataUrl(JPEG_MAGIC, "image/jpeg") });

    const attachments = await getAttachmentsForUser({ user: FAKE_USER, attachmentIds: [a.id, b.id] });
    assert.equal(attachments.length, 2);
    for (const att of attachments) {
      assert.ok(Buffer.isBuffer(att.data), "data field should be a Buffer for MIME construction");
    }
  });

  it("getAttachmentsForUser throws attachment_not_found when one ID belongs to another user", async () => {
    const a = await storeAttachment({ user: FAKE_USER, filename: "a.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });
    const b = await storeAttachment({ user: OTHER_USER, filename: "b.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });

    await assert.rejects(
      () => getAttachmentsForUser({ user: FAKE_USER, attachmentIds: [a.id, b.id] }),
      (err) => {
        assert.equal(err.code, "attachment_not_found");
        return true;
      },
    );
  });

  it("removeAttachments deletes only the requesting user's attachment", async () => {
    const mine = await storeAttachment({ user: FAKE_USER, filename: "mine.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });
    const theirs = await storeAttachment({ user: OTHER_USER, filename: "theirs.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") });

    await removeAttachments({ user: FAKE_USER, attachmentIds: [mine.id, theirs.id] });

    const myResult = await getAttachment({ user: FAKE_USER, attachmentId: mine.id });
    const theirResult = await getAttachment({ user: OTHER_USER, attachmentId: theirs.id });

    assert.equal(myResult, null, "own attachment should be deleted");
    assert.ok(theirResult, "other user's attachment should be untouched");
  });

  it("storeAttachment rejects an unsupported file type", async () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00]);
    await assert.rejects(
      () => storeAttachment({ user: FAKE_USER, filename: "image.gif", mimeType: "image/gif", data: gif }),
      (err) => {
        assert.ok(err.code, "error should have a code");
        return true;
      },
    );
  });

  it("storeAttachment rejects missing user", async () => {
    await assert.rejects(
      () => storeAttachment({ user: null, filename: "a.png", mimeType: "image/png", data: toDataUrl(PNG_MAGIC, "image/png") }),
      (err) => {
        assert.ok(err.message, "should throw an error for unauthenticated upload");
        return true;
      },
    );
  });

  it("getAttachmentsForUser enforces total size limit across attachments", async () => {
    // Store two PNG buffers each just over half the total limit
    const halfPlus = Math.floor(MAX_TOTAL_SIZE / 2) + 1024 * 100;
    const bigPng = Buffer.alloc(halfPlus, 0x00);
    PNG_MAGIC.copy(bigPng, 0);

    // Direct store bypassing service-level size check — use raw stagingStore via multiple separate stores
    // NOTE: storeAttachment validates each file individually (per-file limit), not total.
    // So we need files that are each under MAX_FILE_SIZE but together exceed MAX_TOTAL_SIZE.
    // Each file: ~13MB (under 10MB individual limit? No — let's use smaller but enough total)
    // MAX_TOTAL_SIZE = 25MB, MAX_FILE_SIZE = 10MB
    // So store three 9MB files (each valid individually, total = 27MB > 25MB)
    const nineteen = Math.floor(MAX_FILE_SIZE * 0.9);
    const nearMaxPng = Buffer.alloc(nineteen, 0x00);
    PNG_MAGIC.copy(nearMaxPng, 0);

    const a = await storeAttachment({ user: FAKE_USER, filename: "a.png", mimeType: "image/png", data: nearMaxPng });
    const b = await storeAttachment({ user: FAKE_USER, filename: "b.png", mimeType: "image/png", data: nearMaxPng });
    const c = await storeAttachment({ user: FAKE_USER, filename: "c.png", mimeType: "image/png", data: nearMaxPng });

    await assert.rejects(
      () => getAttachmentsForUser({ user: FAKE_USER, attachmentIds: [a.id, b.id, c.id] }),
      (err) => {
        assert.equal(err.code, "total_attachment_size_exceeded");
        return true;
      },
    );
  });
});

test("Cloudinary attachment metadata schema cannot store raw bytes", () => {
  assert.equal(AttachmentReference.schema.path("buffer"), undefined);
  assert.equal(AttachmentReference.schema.path("data"), undefined);
  assert.ok(AttachmentReference.schema.path("secureUrl"));
  assert.ok(AttachmentReference.schema.path("publicId"));
});

test("Cloudinary upload uses backend credentials and returns only a Cloudinary reference", async () => {
  const previous = process.env.CLOUDINARY_URL;
  const oldFetch = global.fetch;
  process.env.CLOUDINARY_URL = "cloudinary://test-key:test-secret@demo-cloud";
  let form;
  global.fetch = async (_url, options) => {
    form = options.body;
    return { ok: true, json: async () => ({ public_id: "nomi-attachments/test-id", secure_url: "https://res.cloudinary.com/demo/image/upload/test.png", resource_type: "image", bytes: 20 }) };
  };
  try {
    const result = await cloudinaryUpload({ id: "test-id", filename: "test.png", mimeType: "image/png", buffer: Buffer.from("png bytes") });
    assert.equal(result.public_id, "nomi-attachments/test-id");
    assert.equal(form.get("api_key"), "test-key");
    assert.equal(form.get("file").name, "test.png");
    assert.equal(JSON.stringify(result).includes("test-secret"), false);
  } finally {
    global.fetch = oldFetch;
    if (previous === undefined) delete process.env.CLOUDINARY_URL;
    else process.env.CLOUDINARY_URL = previous;
  }
});
