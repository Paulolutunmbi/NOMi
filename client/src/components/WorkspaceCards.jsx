import { friendlyAction } from '../utils/actionLabels'

function initials(name, email) {
  const source = name || email || '?'
  return source.trim().slice(0, 1).toUpperCase()
}

function Avatar({ name, email }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-nomi-orange-light text-sm font-semibold text-nomi-orange-dark">
      {initials(name, email)}
    </span>
  )
}

function CandidateButton({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full items-start gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-all hover:border-nomi-orange hover:shadow-card-hover focus-visible:border-nomi-orange disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  )
}

export function IdentityCandidates({ candidates, onSelect, disabled }) {
  return (
    <div className="nomi-enter space-y-2">
      <p className="text-sm font-medium text-ink">Which person do you mean?</p>
      <div className="space-y-2" role="list" aria-label="Identity candidates">
        {candidates.map((c) => (
          <CandidateButton key={c.selectionId} onClick={() => onSelect(c.selectionId)} disabled={disabled}>
            <Avatar name={c.name} email={c.email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{c.name || 'Unknown name'}</span>
              <span className="block truncate text-xs text-ink-faint">{c.email || 'No email on file'}</span>
            </span>
          </CandidateButton>
        ))}
      </div>
    </div>
  )
}

export function ConversationCandidates({ candidates, onSelect, disabled }) {
  return (
    <div className="nomi-enter space-y-2">
      <p className="text-sm font-medium text-ink">Which conversation?</p>
      <div className="space-y-2" role="list" aria-label="Conversation candidates">
        {candidates.map((c) => (
          <CandidateButton key={c.selectionId} onClick={() => onSelect(c.selectionId)} disabled={disabled}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{c.subject}</span>
              <span className="mt-0.5 block truncate text-xs text-ink-faint">
                {c.name ? (c.email ? `${c.name} <${c.email}>` : c.name) : c.email || 'Unknown sender'}
                {c.date ? ` · ${c.date}` : ''}
              </span>
              {c.snippet && <span className="mt-1 block truncate text-xs text-ink-faint">{c.snippet}</span>}
            </span>
          </CandidateButton>
        ))}
      </div>
    </div>
  )
}

export function CalendarCandidates({ candidates, onSelect, disabled, title = 'Which event?' }) {
  return (
    <div className="nomi-enter space-y-2">
      <p className="text-sm font-medium text-ink">{title}</p>
      <div className="space-y-2" role="list" aria-label="Calendar candidates">
        {candidates.map((c) => (
          <CandidateButton key={c.selectionId} onClick={() => onSelect?.(c.selectionId)} disabled={disabled || !onSelect}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-ink">{c.summary}</span>
              <span className="mt-0.5 block truncate text-xs text-ink-faint">
                {[c.start, c.end].filter(Boolean).join(' – ')}
                {c.location ? ` · ${c.location}` : ''}
              </span>
            </span>
          </CandidateButton>
        ))}
      </div>
    </div>
  )
}

export function ApprovalCard({ action, onDecide, disabled }) {
  return (
    <div className="nomi-enter space-y-3 rounded-2xl border border-nomi-orange/40 bg-nomi-orange-tint p-4">
      <div>
        <p className="text-sm font-semibold text-ink">Ready when you are</p>
        <p className="mt-1 text-sm text-ink-soft">
          NOMI is asking to {friendlyAction(action)}. This approval only covers this one action.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide('allow_once')}
          className="rounded-lg bg-nomi-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:opacity-60"
        >
          Allow once
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide('always_allow')}
          className="rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:border-nomi-orange disabled:opacity-60"
        >
          Always allow
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onDecide('deny')}
          className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-faint transition-colors hover:text-danger disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function EventCard({ event }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <p className="text-sm font-semibold text-ink">{event.summary || 'Untitled event'}</p>
      <p className="mt-0.5 text-xs text-ink-faint">{[event.start, event.end].filter(Boolean).join(' – ')}</p>
      {event.location && <p className="mt-1 text-xs text-ink-faint">{event.location}</p>}
      {event.meetLink && (
        <a href={event.meetLink} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-medium text-nomi-orange hover:text-nomi-orange-dark">
          Join Google Meet
        </a>
      )}
      {Array.isArray(event.attendees) && event.attendees.length > 0 && (
        <p className="mt-2 text-xs text-ink-faint">{event.attendees.length} attendee{event.attendees.length === 1 ? '' : 's'}</p>
      )}
    </div>
  )
}

function MessagePreview({ message }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        <Avatar name={message.displayName || message.sender} email={message.email} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{message.subject || 'No subject'}</p>
          <p className="mt-0.5 truncate text-xs text-ink-faint">{message.sender || message.email || 'Unknown sender'}{message.date ? ` · ${message.date}` : ''}</p>
          {message.snippet && <p className="mt-1 line-clamp-2 text-xs text-ink-faint">{message.snippet}</p>}
          {message.body && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{message.body}</p>}
        </div>
      </div>
    </div>
  )
}

// A confirmation, not a document editor: the backend intentionally never
// returns the drafted body/subject or a draftId to the client (safeResult
// strips draftId/messageId/threadId, and the Gmail provider returns no
// content fields for draft/send at all) — so this shows the outcome the
// server actually confirmed, not fabricated email text.
function DraftOrSendConfirmation({ action, attachmentsMeta }) {
  const isSend = action.includes('send')
  return (
    <div className="nomi-enter flex items-start gap-3 rounded-xl border border-success/30 bg-success-tint p-3.5">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-success" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p className="text-sm font-medium text-ink">{isSend ? 'Email sent' : 'Draft saved to Gmail'}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {isSend ? 'It went out just now.' : 'Open Gmail to review the exact wording before it goes out.'}
        </p>
        {attachmentsMeta?.length > 0 && (
          <p className="mt-1 text-xs text-ink-faint">
            With {attachmentsMeta.length} attachment{attachmentsMeta.length > 1 ? 's' : ''}:{' '}
            {attachmentsMeta.map((a) => a.filename).join(', ')}
          </p>
        )}
      </div>
    </div>
  )
}

export function SuccessCard({ action, result, attachmentsMeta }) {
  if (action === 'gmail.search' && Array.isArray(result?.messages)) {
    if (!result.messages.length) return <EmptyInline text="No matching emails found." />
    return <div className="nomi-enter space-y-2">{result.messages.map((m, i) => <MessagePreview key={i} message={m} />)}</div>
  }
  if (action === 'gmail.read' && result?.message) {
    return <div className="nomi-enter"><MessagePreview message={result.message} /></div>
  }
  if (['gmail.draft', 'gmail.send', 'gmail.draft.reply', 'gmail.send.reply', 'gmail.draft.edit'].includes(action)) {
    return <DraftOrSendConfirmation action={action} attachmentsMeta={attachmentsMeta} />
  }
  if (action === 'calendar.search' && Array.isArray(result?.events)) {
    if (!result.events.length) return <EmptyInline text="No calendar events found." />
    return <div className="nomi-enter space-y-2">{result.events.map((e, i) => <EventCard key={i} event={e} />)}</div>
  }
  if ((action === 'calendar.create' || action === 'calendar.update' || action === 'calendar.read') && result?.event) {
    return (
      <div className="nomi-enter space-y-2">
        <p className="text-sm font-medium text-ink">
          {action === 'calendar.create' ? 'Event created' : action === 'calendar.update' ? 'Event updated' : 'Event details'}
        </p>
        <EventCard event={result.event} />
      </div>
    )
  }
  if (action === 'calendar.delete') {
    return <DeletedConfirmation label="Event deleted" />
  }
  if (action === 'calendar.freebusy' && Array.isArray(result?.busy)) {
    if (!result.busy.length) return <p className="nomi-enter text-sm text-ink-soft">You're free across that window.</p>
    return (
      <div className="nomi-enter space-y-1.5">
        <p className="text-sm font-medium text-ink">Busy blocks</p>
        {result.busy.map((b, i) => (
          <div key={i} className="rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink-soft">
            {[b.start, b.end].filter(Boolean).join(' – ')}
          </div>
        ))}
      </div>
    )
  }
  return <p className="nomi-enter text-sm text-ink-soft">Done.</p>
}

function DeletedConfirmation({ label }) {
  return (
    <div className="nomi-enter flex items-center gap-3 rounded-xl border border-success/30 bg-success-tint p-3.5">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-success" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <p className="text-sm font-medium text-ink">{label}</p>
    </div>
  )
}

export function EmptyInline({ text }) {
  return <p className="nomi-enter text-sm text-ink-faint">{text}</p>
}
