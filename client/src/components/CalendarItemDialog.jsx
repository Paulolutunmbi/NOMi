import { useState } from 'react'
import Modal from './Modal'
import KindBadge from './KindBadge'
import { NomiApiError, NomiNetworkError, cancelCalendarEvent, updateCalendarEvent } from '../api/nomiClient'
import { addDays, describeWhen, toInputValue } from '../utils/calendarItems'

const inputCls = 'mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:border-nomi-orange focus:outline-none'
const btnPrimary = 'rounded-lg bg-nomi-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:opacity-60'
const btnGhost = 'rounded-lg border border-line px-3.5 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-nomi-orange hover:text-ink disabled:opacity-60'
const btnDanger = 'rounded-lg px-3.5 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger-tint disabled:opacity-60'

// Birthdays and Gmail reservations are managed by Google itself.
const GOOGLE_MANAGED = new Set(['birthday', 'reservation'])

function errorText(error) {
  if (error instanceof NomiNetworkError) return "You're offline — check your connection and try again."
  if (error instanceof NomiApiError && error.message) return error.message
  return 'Something went wrong. Please try again.'
}

function Field({ label, children }) {
  return <label className="block text-xs font-medium text-ink-soft">{label}{children}</label>
}

// View, edit or cancel one calendar event (kind: event | appointment | ...).
export default function CalendarItemDialog({ item, tz, onClose, onChanged, onAsk }) {
  const [mode, setMode] = useState('view') // view | edit | confirm
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(() => ({
    title: item.summary || '', location: item.location || '', description: item.description || '',
    kind: item.kind === 'appointment' ? 'appointment' : 'event',
    start: item.allDay ? item.start : toInputValue(item.start, tz),
    // Google's all-day end date is exclusive; people think in inclusive dates.
    end: item.allDay ? addDays(item.end || addDays(item.start, 1), -1) : toInputValue(item.end || item.start, tz),
  }))
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const managed = GOOGLE_MANAGED.has(item.kind)
  const canEdit = item.canEdit && !managed
  const hasGuests = item.attendees?.length > 0
  const title = item.summary || 'Untitled event'
  const removeLabel = item.canEdit ? 'Cancel event' : 'Remove from my calendar'

  const run = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); await onChanged(); onClose() } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  const save = () => {
    if (!form.title.trim()) { setError('Give the event a title.'); return }
    const common = { summary: form.title.trim(), location: form.location, description: form.description, kind: form.kind }
    if (item.allDay) {
      if (form.end < form.start) { setError('The end date can’t be before the start date.'); return }
      return run(() => updateCalendarEvent(item.id, { ...common, startDate: form.start, endDate: addDays(form.end, 1) }))
    }
    if (!form.start || !form.end || form.end <= form.start) { setError('The end time must be after the start time.'); return }
    return run(() => updateCalendarEvent(item.id, { ...common, startDateTime: form.start, endDateTime: form.end, timeZone: tz }))
  }
  const remove = () => run(() => cancelCalendarEvent(item.id))

  return (
    <Modal open onClose={onClose} title={mode === 'edit' ? 'Edit event' : mode === 'confirm' ? removeLabel : 'Details'} wide>
      {mode === 'view' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={item.kind} />
            {item.recurring && <span className="text-xs text-ink-faint">Repeats</span>}
          </div>
          <p className="text-base font-semibold text-ink">{title}</p>
          <p className="text-sm text-ink-soft">{describeWhen(item, tz)}</p>
          {item.location && <p className="text-sm text-ink-soft">📍 {item.location}</p>}
          {item.description && <p className="whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-sm text-ink-soft">{item.description}</p>}
          {hasGuests && (
            <div>
              <p className="text-xs font-medium text-ink-faint">Guests</p>
              <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
                {item.attendees.map((a) => <li key={a.email}>{a.email}{a.responseStatus ? <span className="text-xs text-ink-faint"> · {a.responseStatus}</span> : null}</li>)}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3 text-sm">
            {item.meetLink && <a href={item.meetLink} target="_blank" rel="noreferrer" className="font-medium text-nomi-orange hover:text-nomi-orange-dark">Join Google Meet</a>}
            {item.htmlLink && /^https:\/\//.test(item.htmlLink) && (
              <a href={item.htmlLink} target="_blank" rel="noreferrer" className="font-medium text-ink-soft underline hover:text-ink">Open in Google Calendar</a>
            )}
          </div>
          {item.recurring && <p className="text-xs text-ink-faint">This is one occurrence of a repeating event — changes and cancellation apply to this occurrence only.</p>}
          {managed && <p className="text-xs text-ink-faint">Google manages this one, so it can’t be edited here.</p>}
          {!managed && !item.canEdit && <p className="text-xs text-ink-faint">Someone else organizes this, so you can’t change it — you can remove it from your own calendar.</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {canEdit && <button type="button" onClick={() => { setError(''); setMode('edit') }} className={btnPrimary}>Edit</button>}
            {onAsk && <button type="button" onClick={() => onAsk(item)} className={btnGhost}>Ask NOMI</button>}
            {!managed && <button type="button" onClick={() => { setError(''); setMode('confirm') }} className={`${btnDanger} ml-auto`}>{removeLabel}</button>}
          </div>
        </div>
      )}

      {mode === 'edit' && (
        <div className="space-y-3">
          <Field label="Title"><input className={inputCls} value={form.title} onChange={set('title')} maxLength={500} autoFocus /></Field>
          <Field label="Type">
            <select className={inputCls} value={form.kind} onChange={set('kind')}>
              <option value="event">Event</option>
              <option value="appointment">Appointment</option>
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={item.allDay ? 'First day' : 'Starts'}><input className={inputCls} type={item.allDay ? 'date' : 'datetime-local'} value={form.start} onChange={set('start')} /></Field>
            <Field label={item.allDay ? 'Last day' : 'Ends'}><input className={inputCls} type={item.allDay ? 'date' : 'datetime-local'} value={form.end} onChange={set('end')} /></Field>
          </div>
          <Field label="Location"><input className={inputCls} value={form.location} onChange={set('location')} maxLength={500} /></Field>
          <Field label="Description"><textarea className={`${inputCls} min-h-20`} value={form.description} onChange={set('description')} maxLength={4000} /></Field>
          {hasGuests && <p className="text-xs text-ink-faint">Guests will get an update from Google if you change the time.</p>}
          {item.recurring && <p className="text-xs text-ink-faint">Applies to this occurrence only.</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2 border-t border-line pt-3">
            <button type="button" disabled={busy} onClick={save} className={btnPrimary}>{busy ? 'Saving…' : 'Save changes'}</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setMode('view') }} className={btnGhost}>Back</button>
          </div>
        </div>
      )}

      {mode === 'confirm' && (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {item.canEdit ? `Cancel “${title}”?${hasGuests ? ' Your guests will be notified by Google.' : ''} This can’t be undone.` : `Remove “${title}” from your calendar?`}
          </p>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={remove} className="rounded-lg bg-danger px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60">{busy ? 'Working…' : `Yes, ${removeLabel.toLowerCase()}`}</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setMode('view') }} className={btnGhost}>Keep it</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
