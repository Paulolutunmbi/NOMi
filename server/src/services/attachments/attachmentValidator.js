const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB individual file limit
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB total per email limit
const MAX_ATTACHMENTS_COUNT = 10;

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/**
 * Validates magic bytes against expected MIME types to prevent extension/MIME spoofing.
 */
const detectMimeTypeFromMagicBytes = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  // JPEG / JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  // WebP: RIFF (bytes 0..3) ... WEBP (bytes 8..11)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
};

/**
 * Sanitizes filename to prevent directory traversal and injection.
 */
const sanitizeFilename = (filename, detectedMimeType) => {
  const defaultExt = detectedMimeType === "image/png" ? ".png"
    : detectedMimeType === "image/webp" ? ".webp"
    : ".jpg";

  if (typeof filename !== "string" || !filename.trim()) {
    return `attachment${defaultExt}`;
  }

  // Strip path traversal characters and directory separators
  let cleaned = filename
    .replace(/^.*[\\/]/, "") // remove path
    .replace(/\0/g, "") // remove null bytes
    .replace(/[\x00-\x1f\x7f]/g, "") // remove control characters
    .trim();

  // If filename becomes empty or begins with a dot, provide default name
  if (!cleaned || cleaned.startsWith(".")) {
    cleaned = `attachment${defaultExt}`;
  }

  // Truncate to 255 chars
  return cleaned.slice(0, 255);
};

/**
 * Validates a single attachment payload.
 */
const validateAttachment = ({ filename, mimeType, data }) => {
  if (!data) {
    return { valid: false, code: "attachment_missing_data", message: "Attachment data is required" };
  }

  let buffer;
  if (Buffer.isBuffer(data)) {
    buffer = data;
  } else if (typeof data === "string") {
    // Strip data URL scheme if present (e.g. "data:image/png;base64,...")
    const base64Data = data.includes(";base64,") ? data.split(";base64,")[1] : data;
    try {
      buffer = Buffer.from(base64Data, "base64");
    } catch {
      return { valid: false, code: "attachment_invalid_encoding", message: "Invalid base64 attachment data" };
    }
  } else {
    return { valid: false, code: "attachment_invalid_data", message: "Attachment data must be a Buffer or base64 string" };
  }

  if (buffer.length === 0) {
    return { valid: false, code: "attachment_empty", message: "Attachment cannot be empty" };
  }

  if (buffer.length > MAX_FILE_SIZE) {
    return { valid: false, code: "attachment_too_large", message: `Attachment exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB` };
  }

  const detectedMimeType = detectMimeTypeFromMagicBytes(buffer);
  if (!detectedMimeType || !ALLOWED_MIME_TYPES.has(detectedMimeType)) {
    return { valid: false, code: "attachment_unsupported_type", message: "Only PNG, JPEG, and WebP images are supported" };
  }

  // If client provided a MIME type, check that it matches detected type (normalize jpg/jpeg)
  const normalizedClientMime = typeof mimeType === "string" ? mimeType.trim().toLowerCase().replace("image/jpg", "image/jpeg") : null;
  if (normalizedClientMime && normalizedClientMime !== detectedMimeType) {
    return { valid: false, code: "attachment_mime_mismatch", message: "MIME type does not match image content" };
  }

  const sanitized = sanitizeFilename(filename, detectedMimeType);

  return {
    valid: true,
    filename: sanitized,
    mimeType: detectedMimeType,
    size: buffer.length,
    buffer,
  };
};

/**
 * Validates a collection of attachments for total size and count.
 */
const validateAttachmentSet = (attachments = []) => {
  if (!Array.isArray(attachments)) {
    return { valid: false, code: "invalid_attachments_format", message: "Attachments must be an array" };
  }

  if (attachments.length > MAX_ATTACHMENTS_COUNT) {
    return { valid: false, code: "too_many_attachments", message: `Maximum ${MAX_ATTACHMENTS_COUNT} attachments permitted` };
  }

  let totalSize = 0;
  const validated = [];

  for (const item of attachments) {
    const result = validateAttachment(item);
    if (!result.valid) return result;

    totalSize += result.size;
    if (totalSize > MAX_TOTAL_SIZE) {
      return { valid: false, code: "total_attachment_size_exceeded", message: `Total attachments exceed limit of ${MAX_TOTAL_SIZE / (1024 * 1024)}MB` };
    }

    validated.push({
      filename: result.filename,
      mimeType: result.mimeType,
      size: result.size,
      buffer: result.buffer,
    });
  }

  return { valid: true, attachments: validated, totalSize };
};

module.exports = {
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  MAX_ATTACHMENTS_COUNT,
  ALLOWED_MIME_TYPES,
  detectMimeTypeFromMagicBytes,
  sanitizeFilename,
  validateAttachment,
  validateAttachmentSet,
};
