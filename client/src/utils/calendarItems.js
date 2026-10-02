// Shared by the Calendar screen and the chat cards so an appointment and an
// event always look the same wherever they appear.

export const KIND_META = {
  appointment: { label: 'Appointment', badge: 'bg-warning-tint text-warning' },
  event: { label: 'Event', badge: 'bg-nomi-orange-light text-nomi-orange-dark' },
  birthday: { label: 'Birthday', badge: 'bg-surface-sunken text-ink-soft' },
  focus: { label: 'Focus time', badge: 'bg-surface-sunken text-ink-soft' },
  out_of_office: { label: 'Out of office', badge: 'bg-surface-sunken text-ink-soft' },
  working_location: { label: 'Working location', badge: 'bg-surface-sunken text-ink-soft' },
  reservation: { label: 'Reservation', badge: 'bg-surface-sunken text-ink-soft' },
}
export const kindMeta = (kind) => KIND_META[kind] || KIND_META.event

const pad = (n) => String(n).padStart(2, '0')
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const safeZone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz } catch { return browserZone() }
}

function zoneParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]))
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute }
}
const offsetMinutes = (tz, date) => {
  const { y, m, d, h, mi } = zoneParts(date, tz)
  return Math.round((Date.UTC(y, m - 1, d, h, mi) - Math.floor(date.getTime() / 60000) * 60000) / 60000)
}

// "YYYY-MM-DD" of an instant as seen in a time zone.
export const dayKeyOf = (date, tz) => {
  const { y, m, d } = zoneParts(date, tz)
  return `${y}-${pad(m)}-${pad(d)}`
}
export const addDays = (key, n) => {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}
// The instant at which a wall-clock day/time starts in a time zone.
export const zonedInstant = (key, tz, time = '00:00') => {
  const [y, m, d] = key.split('-').map(Number)
  const [h, mi] = time.split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, h, mi)
  let off = offsetMinutes(tz, new Date(guess))
  off = offsetMinutes(tz, new Date(guess - off * 60000))
  return new Date(guess - off * 60000)
}
// Value for <input type="datetime-local">, in the person's zone.
export const toInputValue = (iso, tz) => {
  const { y, m, d, h, mi } = zoneParts(new Date(iso), tz)
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}`
}
export const formatTime = (iso, tz) =>
  new Intl.DateTimeFormat(undefined, { timeZone: safeZone(tz), hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
export const formatDayLabel = (key, todayKey) => {
  if (key === todayKey) return 'Today'
  if (key === addDays(todayKey, 1)) return 'Tomorrow'
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}
export const formatShortDay = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
}

// Human "when" line for an event.
export function describeWhen(item, tz) {
  if (item.allDay) {
    const last = addDays(item.end || item.start, -1)
    return last > item.start ? `${formatShortDay(item.start)} – ${formatShortDay(last)} · All day` : `${formatShortDay(item.start)} · All day`
  }
  if (!item.start) return ''
  const day = formatShortDay(dayKeyOf(new Date(item.start), tz))
  return `${day}, ${formatTime(item.start, tz)}${item.end ? ` – ${formatTime(item.end, tz)}` : ''}`
}

// Groups events into Map<dayKey, events[]> for the window [startKey, endKey]
// (inclusive). Within a day: all-day events first, then timed events in order.
export function groupAgenda({ events, startKey, endKey, tz }) {
  const days = new Map()
  const put = (key, item) => { if (!days.has(key)) days.set(key, []); days.get(key).push(item) }
  for (const e of events) {
    if (e.allDay) {
      const last = addDays(e.end || addDays(e.start, 1), -1)
      for (let k = e.start < startKey ? startKey : e.start; k <= last && k <= endKey; k = addDays(k, 1)) put(k, e)
    } else if (e.start) {
      const k = dayKeyOf(new Date(e.start), tz)
      if (k >= startKey && k <= endKey) put(k, e)
    }
  }
  for (const list of days.values()) list.sort((a, b) => (a.allDay ? 0 : 1) - (b.allDay ? 0 : 1) || String(a.start || '').localeCompare(String(b.start || '')))
  return new Map([...days.entries()].sort(([a], [b]) => a.localeCompare(b)))
}
