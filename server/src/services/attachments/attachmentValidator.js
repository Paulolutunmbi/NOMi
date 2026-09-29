const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB individual file limit (also keeps videos short)
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25MB total per email limit
const MAX_ATTACHMENTS_COUNT = 10;

// Every supported type. `kind` decides how the file is stored (Cloudinary
// resource type). Nothing executable, scriptable or archive-like is allowed.
const OOXML = {
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", marker: "word/" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", marker: "xl/" },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", marker: "ppt/" },
};
const OLE = {
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
};
const TEXT = { txt: "text/plain", csv: "text/csv", md: "text/markdown" };

const ALLOWED_MIME_TYPES = new Set([
  "image/png", "image/jpeg", "image/webp",
  "application/pdf",
  ...Object.values(OOXML).map((item) => item.mime), ...Object.values(OLE), ...Object.values(TEXT),
  "video/mp4", "video/quicktime", "video/webm",
]);

const SUPPORTED_TYPES_MESSAGE = "Supported files: images (PNG, JPEG, WebP), PDF, Word, Excel, PowerPoint, TXT/CSV, and short videos (MP4, MOV, WebM).";

const extensionOf = (filename) => {
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return match ? match[1] : "";
};

/**
 * Identifies the file from its real bytes (never from the client's claim) to
 * prevent extension/MIME spoofing. Returns { mimeType, kind, ext } or null.
 */
const detectFileType = (buffer, filename) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  const ext = extensionOf(filename);
  const ascii = (start, end) => buffer.toString("latin1", start, end);

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return { mimeType: "image/png", kind: "image", ext: "png" };
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: "image/jpeg", kind: "image", ext: "jpg" };
  // WebP: RIFF....WEBP
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mimeType: "image/webp", kind: "image", ext: "webp" };
  // PDF: %PDF-
  if (ascii(0, 5) === "%PDF-") return { mimeType: "application/pdf", kind: "raw", ext: "pdf" };
  // MP4 / MOV: "ftyp" box at byte 4 ("qt  " brand = QuickTime .mov)
  if (ascii(4, 8) === "ftyp") {
    const isMov = ascii(8, 12) === "qt  " || ext === "mov";
    return isMov ? { mimeType: "video/quicktime", kind: "video", ext: "mov" } : { mimeType: "video/mp4", kind: "video", ext: "mp4" };
  }
  // WebM / Matroska: 1A 45 DF A3
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return { mimeType: "video/webm", kind: "video", ext: "webm" };
  // Modern Office files are ZIP containers. Only accept them when the name says
  // docx/xlsx/pptx AND the package really contains that format's parts.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const office = OOXML[ext];
    if (office && buffer.includes("[Content_Types].xml") && buffer.includes(office.marker)) return { mimeType: office.mime, kind: "raw", ext };
    return null;
  }
  // Legacy Office files (OLE2 compound document).
  if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0 && buffer[4] === 0xa1 && buffer[5] === 0xb1 && buffer[6] === 0x1a && buffer[7] === 0xe1) {
    return OLE[ext] ? { mimeType: OLE[ext], kind: "raw", ext } : null;
  }
  // Plain text: no signature, so it must be named .txt/.csv/.md, contain no
  // binary bytes, and be valid UTF-8.
  if (TEXT[ext]) {
    if (buffer.includes(0)) return null;
    try { new TextDecoder("utf-8", { fatal: true }).decode(buffer); } catch { return null; }
    return { mimeType: TEXT[ext], kind: "raw", ext };
  }
  return null;
};

// Kept for callers/tests that only care about the MIME type.
const detectMimeTypeFromMagicBytes = (buffer, filename = "") => detectFileType(buffer, filename)?.mimeType || null;

/**
 * Sanitizes filename to prevent directory traversal and header injection.
 */
const sanitizeFilename = (filename, detected) => {
  const detectedMimeType = typeof detected === "string" ? detected : detected?.mimeType;
  const detectedExt = typeof detected === "object" && detected?.ext ? detected.ext
    : detectedMimeType === "image/png" ? "png" : detectedMimeType === "image/webp" ? "webp" : "jpg";
  const defaultExt = `.${detectedExt}`;

  if (typeof filename !== "string" || !filename.trim()) return `attachment${defaultExt}`;

  let cleaned = filename
    .replace(/^.*[\\/]/, "") // remove path
    .replace(/[\x00-\x1f\x7f]/g, "") // remove control characters (incl. CR/LF and null bytes)
    .replace(/["<>|:*?]/g, "_") // characters that break MIME headers or filesystems
    .trim();

  if (!cleaned || cleaned.startsWith(".")) cleaned = `attachment${defaultExt}`;
  // Truncate to 255 chars
  return cleaned.slice(0, 255);
};

const MIME_ALIASES = { "image/jpg": "image/jpeg", "audio/mp4": "video/mp4" };

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

  const detected = detectFileType(buffer, filename);
  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mimeType)) {
    return { valid: false, code: "attachment_unsupported_type", message: SUPPORTED_TYPES_MESSAGE };
  }

  // If the client declared a MIME type, it must agree with the real content.
  // Office files and text are lenient because browsers report them
  // inconsistently (empty, octet-stream, or a vendor-specific type).
  const declared = typeof mimeType === "string" ? mimeType.trim().toLowerCase() : "";
  const normalizedClientMime = MIME_ALIASES[declared] || declared;
  const lenient = detected.kind === "raw" && detected.mimeType !== "application/pdf";
  if (normalizedClientMime && normalizedClientMime !== "application/octet-stream" && !lenient && normalizedClientMime !== detected.mimeType) {
    return { valid: false, code: "attachment_mime_mismatch", message: "MIME type does not match file content" };
  }

  const sanitized = sanitizeFilename(filename, detected);

  return {
    valid: true,
    filename: sanitized,
    mimeType: detected.mimeType,
    kind: detected.kind,
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
  SUPPORTED_TYPES_MESSAGE,
  detectFileType,
  detectMimeTypeFromMagicBytes,
  sanitizeFilename,
  validateAttachment,
  validateAttachmentSet,
};
