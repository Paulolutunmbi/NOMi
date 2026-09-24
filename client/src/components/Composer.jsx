import { useRef, useState } from 'react'
import { uploadAttachment, deleteAttachment, NomiApiError } from '../api/nomiClient'
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENTS_COUNT,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  formatBytes,
  friendlyAttachmentError,
  readFileAsDataUrl,
} from '../utils/attachments'

let attachmentCounter = 0
const nextAttachmentId = () => `a${++attachmentCounter}`

function AttachmentChip({ attachment, onRemove }) {
  const { filename, size, status, error } = attachment
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
        status === 'error' ? 'border-danger/40 bg-danger-tint text-danger' : 'border-line bg-surface-muted text-ink-soft'
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
        <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="9" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
        <path d="M5 17.5 9.5 13a1.6 1.6 0 0 1 2.2 0L14 15.3M15.5 12.5 17 14a1.6 1.6 0 0 1 .5 1.1V17.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="max-w-[9rem] truncate font-medium">{filename}</span>
      {status === 'uploading' && <span className="shrink-0 text-ink-faint">Uploading…</span>}
      {status === 'ready' && <span className="shrink-0 text-ink-faint">{formatBytes(size)}</span>}
      {status === 'error' && <span className="shrink-0">{error}</span>}
      <button
        type="button"
        onClick={() => onRemove(attachment.clientId)}
        aria-label={`Remove attachment ${filename}`}
        className="ml-0.5 shrink-0 rounded-full p-0.5 text-current transition-colors hover:bg-ink/10"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

export default function Composer({ placeholder, disabled, onSend }) {
  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)
  const [attachments, setAttachments] = useState([])

  const readyAttachments = attachments.filter((a) => a.status === 'ready')
  const hasUploading = attachments.some((a) => a.status === 'uploading')

  const updateAttachment = (clientId, patch) => {
    setAttachments((prev) => prev.map((a) => (a.clientId === clientId ? { ...a, ...patch } : a)))
  }

  const uploadOne = async (clientId, file) => {
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const { attachment } = await uploadAttachment({ filename: file.name, mimeType: file.type, data: dataUrl })
      updateAttachment(clientId, {
        status: 'ready',
        serverId: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })
    } catch (error) {
      const message = error instanceof NomiApiError ? friendlyAttachmentError(error) : "That file couldn't be attached."
      updateAttachment(clientId, { status: 'error', error: message })
    }
  }

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || [])
    if (!incoming.length) return

    const existingReadyCount = attachments.filter((a) => a.status !== 'error').length
    const existingReadySize = attachments
      .filter((a) => a.status === 'ready')
      .reduce((sum, a) => sum + a.size, 0)

    let runningCount = existingReadyCount
    let runningSize = existingReadySize
    const toAdd = []

    for (const file of incoming) {
      const clientId = nextAttachmentId()

      if (runningCount >= MAX_ATTACHMENTS_COUNT) {
        toAdd.push({ clientId, filename: file.name, size: file.size, status: 'error', error: `You can attach up to ${MAX_ATTACHMENTS_COUNT} files.` })
        continue
      }
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        toAdd.push({ clientId, filename: file.name, size: file.size, status: 'error', error: 'Only PNG, JPEG, and WebP images are supported.' })
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        toAdd.push({ clientId, filename: file.name, size: file.size, status: 'error', error: 'That file is larger than the 10MB limit.' })
        continue
      }
      if (runningSize + file.size > MAX_TOTAL_SIZE) {
        toAdd.push({ clientId, filename: file.name, size: file.size, status: 'error', error: 'These attachments together are larger than the 25MB limit.' })
        continue
      }

      runningCount += 1
      runningSize += file.size
      toAdd.push({ clientId, file, filename: file.name, size: file.size, status: 'uploading' })
    }

    setAttachments((prev) => [...prev, ...toAdd])
    toAdd.filter((a) => a.status === 'uploading').forEach((a) => uploadOne(a.clientId, a.file))
  }

  const removeAttachment = (clientId) => {
    const target = attachments.find((a) => a.clientId === clientId)
    setAttachments((prev) => prev.filter((a) => a.clientId !== clientId))
    if (target?.status === 'ready' && target.serverId) {
      deleteAttachment(target.serverId).catch(() => {
        // Best-effort cleanup; the server also expires staged attachments on its own.
      })
    }
  }

  const submit = () => {
    const value = textareaRef.current?.value?.trim()
    if (!value || disabled || hasUploading) return
    const attachmentIds = readyAttachments.map((a) => a.serverId)
    const attachmentsMeta = readyAttachments.map((a) => ({ filename: a.filename, size: a.size, mimeType: a.mimeType }))
    onSend(value, attachmentIds, attachmentsMeta)
    textareaRef.current.value = ''
    textareaRef.current.style.height = 'auto'
    setAttachments([])
  }

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  const handleInput = (event) => {
    const el = event.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  return (
    <div>
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" aria-label="Attachments">
          {attachments.map((attachment) => (
            <AttachmentChip key={attachment.clientId} attachment={attachment} onRemove={removeAttachment} />
          ))}
        </div>
      )}
      <div
        className={`flex items-end gap-2 rounded-2xl border bg-surface p-2.5 shadow-card transition-colors focus-within:border-nomi-orange ${
          disabled ? 'border-line opacity-70' : 'border-line'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp"
          multiple
          disabled={disabled}
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          aria-label="Attach an image"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-faint transition-colors hover:bg-surface-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 12.5V8a4 4 0 0 1 8 0v8a5 5 0 0 1-10 0V8.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          maxLength={4000}
          disabled={disabled}
          placeholder={placeholder}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          aria-label="Message NOMI"
          className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || hasUploading}
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-nomi-orange text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:bg-line-strong"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 12h15m0 0-6-6m6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
