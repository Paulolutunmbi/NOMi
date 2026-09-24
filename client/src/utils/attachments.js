// These mirror server/src/services/attachments/attachmentValidator.js exactly.
// Client-side checks are a UX nicety (fail fast, no needless upload) — the
// backend re-validates everything independently and is the actual source of truth.
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024 // 25MB per email
export const MAX_ATTACHMENTS_COUNT = 10

export const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

const ATTACHMENT_ERROR_MESSAGES = {
  ATTACHMENT_MISSING_DATA: 'That file appears to be empty.',
  ATTACHMENT_EMPTY: 'That file appears to be empty.',
  ATTACHMENT_INVALID_ENCODING: "NOMI couldn't read that file.",
  ATTACHMENT_INVALID_DATA: "NOMI couldn't read that file.",
  ATTACHMENT_TOO_LARGE: 'That file is larger than the 10MB limit.',
  ATTACHMENT_UNSUPPORTED_TYPE: 'Only PNG, JPEG, and WebP images are supported.',
  ATTACHMENT_MIME_MISMATCH: "That file's contents don't match its file type.",
  TOTAL_ATTACHMENT_SIZE_EXCEEDED: 'These attachments together are larger than the 25MB limit.',
  TOO_MANY_ATTACHMENTS: 'You can attach up to 10 files.',
}

export function friendlyAttachmentError(error) {
  return ATTACHMENT_ERROR_MESSAGES[error?.code] || error?.message || "That file couldn't be attached."
}
