import { kindMeta } from '../utils/calendarItems'

// Always says what the thing is: Task, Appointment, Event (or a Google-managed
// type such as Birthday).
export default function KindBadge({ kind }) {
  const meta = kindMeta(kind)
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.badge}`}>{meta.label}</span>
}
