import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import CalendarItemDialog from './CalendarItemDialog'
import KindBadge from './KindBadge'
import { NomiApiError, NomiNetworkError, fetchAgenda } from '../api/nomiClient'
import { useAuth } from '../context/AuthContext'
import { addDays, browserZone, dayKeyOf, describeWhen, formatDayLabel, formatShortDay, formatTime, groupAgenda, kindMeta, zonedInstant } from '../utils/calendarItems'

const SPAN_DAYS = 7

function EventRow({ item, tz, onOpen }) {
  const title = item.summary || 'Untitled event'
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      aria-label={`${kindMeta(item.kind).label}: ${title}. ${describeWhen(item, tz)}. Open details`}
      className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-all hover:border-nomi-orange hover:shadow-card-hover focus-visible:border-nomi-orange"
    >
      <span className="w-16 shrink-0 text-xs font-medium text-ink-faint">{item.allDay ? 'All day' : formatTime(item.start, tz)}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{title}</span>
        {item.location && <span className="mt-0.5 block truncate text-xs text-ink-faint">{item.location}</span>}
      </span>
      <KindBadge kind={item.kind} />
    </button>
  )
}

export default function CalendarAgenda({ onAsk }) {
  const { googleConnected, googleStatusLoading } = useAuth()
  const [tz, setTz] = useState(browserZone())
  const [startKey, setStartKey] = useState(null)
  const [events, setEvents] = useState([])
  const [state, setState] = useState('loading') // loading | ready | error
  const [errorMessage, setErrorMessage] = useState('')
  const [selected, setSelected] = useState(null)
  const [reload, setReload] = useState(0)

  // Resolve "today" in the person's own zone, then page by weeks.
  const todayKey = useMemo(() => dayKeyOf(new Date(), tz), [tz])
  const windowStart = startKey || todayKey
  const windowEnd = addDays(windowStart, SPAN_DAYS - 1)

  useEffect(() => {
    if (googleStatusLoading || !googleConnected) return undefined
    const controller = new AbortController()
    fetchAgenda({
      from: zonedInstant(windowStart, tz).toISOString(),
      to: zonedInstant(addDays(windowEnd, 1), tz).toISOString(),
      signal: controller.signal,
    })
      .then((res) => {
        if (res.timeZone && res.timeZone !== tz) setTz(res.timeZone)
        setEvents(res.events || [])
        setState('ready'); setErrorMessage('')
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setErrorMessage(error instanceof NomiNetworkError ? 'You’re offline.' : error instanceof NomiApiError && error.message ? error.message : 'Your calendar couldn’t be loaded.')
        setState('error')
      })
    return () => controller.abort()
  }, [windowStart, windowEnd, tz, reload, googleConnected, googleStatusLoading])

  const refresh = useCallback(() => { setState((s) => (s === 'ready' ? s : 'loading')); setReload((n) => n + 1) }, [])
  const goto = (key) => { setState('loading'); setStartKey(key) }

  const days = useMemo(() => groupAgenda({ events, startKey: windowStart, endKey: windowEnd, tz }), [events, windowStart, windowEnd, tz])
  const isCurrentWindow = windowStart === todayKey

  if (!googleStatusLoading && !googleConnected) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <h2 className="text-lg font-semibold text-ink">Connect Google to see your calendar</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-soft">Your events and appointments will show up here once Google is connected.</p>
        <Link to="/app/settings" className="mt-4 rounded-lg bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white hover:bg-nomi-orange-dark">Connect in Settings</Link>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-5 sm:px-8">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">{formatShortDay(windowStart)} – {formatShortDay(windowEnd)}</h2>
            <p className="text-xs text-ink-faint">Tap anything to see details, edit or cancel it.</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Previous week" onClick={() => goto(addDays(windowStart, -SPAN_DAYS))} className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-soft hover:border-nomi-orange">‹</button>
            <button type="button" disabled={isCurrentWindow} onClick={() => goto(todayKey)} className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft hover:border-nomi-orange disabled:opacity-50">Today</button>
            <button type="button" aria-label="Next week" onClick={() => goto(addDays(windowStart, SPAN_DAYS))} className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-soft hover:border-nomi-orange">›</button>
          </div>
        </div>

        {state === 'loading' && <p className="py-10 text-center text-sm text-ink-faint">Loading your calendar…</p>}
        {state === 'error' && (
          <div role="alert" className="rounded-xl border border-danger/30 bg-danger-tint p-4 text-sm text-danger">
            <p>{errorMessage}</p>
            <button type="button" onClick={refresh} className="mt-2 font-medium underline hover:no-underline">Try again</button>
          </div>
        )}

        {state === 'ready' && (
          <>
            {!days.size && <p className="py-10 text-center text-sm text-ink-faint">Nothing scheduled for these days.</p>}
            {[...days.entries()].map(([key, items]) => (
              <section key={key} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{formatDayLabel(key, todayKey)}</h3>
                {items.map((item) => <EventRow key={`${item.id}-${key}`} item={item} tz={tz} onOpen={setSelected} />)}
              </section>
            ))}
          </>
        )}
      </div>

      {selected && (
        <CalendarItemDialog
          key={selected.id}
          item={selected}
          tz={tz}
          onClose={() => setSelected(null)}
          onChanged={refresh}
          onAsk={onAsk ? (item) => { setSelected(null); onAsk(item, tz) } : undefined}
        />
      )}
    </div>
  )
}
