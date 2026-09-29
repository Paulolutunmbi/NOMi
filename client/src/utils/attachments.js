// These mirror server/src/services/attachments/attachmentValidator.js exactly.
// Client-side checks are a UX nicety (fail fast, no needless upload) — the
// backend re-validates everything independently and is the actual source of truth.
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB per file
export const MAX_TOTAL_SIZE = 25 * 1024 * 1024 // 25MB per email
export const MAX_ATTACHMENTS_COUNT = 10

// Videos must be short: 30 seconds and within the 10MB file limit.
export const MAX_VIDEO_SECONDS = 30

// What the file picker offers. The server still verifies the real file
// contents, so this list is only a convenience filter.
export const ACCEPT_ATTRIBUTE = [
  'image/png', 'image/jpeg', 'image/webp',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.md',
  'video/mp4', 'video/quicktime', 'video/webm', '.mp4', '.mov', '.webm',
].join(',')

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'mp4', 'mov', 'webm'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'webm'])
export const SUPPORTED_FILES_MESSAGE = 'Supported: images, PDF, Word, Excel, PowerPoint, TXT/CSV, and short videos (MP4, MOV, WebM).'

export const fileExtension = (name) => {
  const match = String(name || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)
  return match ? match[1] : ''
}
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])
export const isSupportedFile = (file) => SUPPORTED_EXTENSIONS.has(fileExtension(file?.name)) || ALLOWED_IMAGE_TYPES.has(file?.type)
export const isVideoFile = (file) => VIDEO_EXTENSIONS.has(fileExtension(file?.name)) || String(file?.type || '').startsWith('video/')
export const fileKind = (nameOrFile) => {
  const name = typeof nameOrFile === 'string' ? nameOrFile : nameOrFile?.filename || nameOrFile?.name
  const ext = fileExtension(name)
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  return 'document'
}

// Resolves with the video's length in seconds, or null if the browser can't
// read it (the server's size limit still applies either way).
export function readVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (value) => { URL.revokeObjectURL(url); resolve(value) }
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) ? video.duration : null)
    video.onerror = () => done(null)
    video.src = url
  })
}

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
  ATTACHMENT_UNSUPPORTED_TYPE: 'That file type isn\'t supported. ' + SUPPORTED_FILES_MESSAGE,
  ATTACHMENT_MIME_MISMATCH: "That file's contents don't match its file type.",
  TOTAL_ATTACHMENT_SIZE_EXCEEDED: 'These attachments together are larger than the 25MB limit.',
  TOO_MANY_ATTACHMENTS: 'You can attach up to 10 files.',
}

export function friendlyAttachmentError(error) {
  return ATTACHMENT_ERROR_MESSAGES[error?.code] || error?.message || "That file couldn't be attached."
}
