import { useMemo } from 'react'
import { COUNTRIES, findCountryByName, zonesForCountry } from '../utils/countries'

const selectClass =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink focus:border-nomi-orange focus:outline-none'

// Controlled picker: { country: 'Nigeria', timeZone: 'Africa/Lagos' }.
// Choosing a country selects its first time zone; countries with several
// zones (USA, Canada, Brazil, Russia…) also show a second dropdown so the
// user can pick the zone for their own state/region.
export default function CountryTimeZonePicker({ value, onChange, idPrefix = 'country' }) {
  const selected = findCountryByName(value?.country)
  const zones = useMemo(() => zonesForCountry(selected?.id), [selected?.id])

  const handleCountry = (event) => {
    const next = COUNTRIES.find((c) => c.id === event.target.value)
    if (!next) return onChange({ country: '', timeZone: '' })
    const first = zonesForCountry(next.id)[0]
    onChange({ country: next.name, timeZone: first?.timeZone || '' })
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-ink-soft" htmlFor={`${idPrefix}-country`}>
        Country
        <select id={`${idPrefix}-country`} value={selected?.id || ''} onChange={handleCountry} required className={`${selectClass} mt-1.5`}>
          <option value="">Select your country…</option>
          {COUNTRIES.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      {selected && zones.length > 0 && (
        <label className="block text-sm font-medium text-ink-soft" htmlFor={`${idPrefix}-tz`}>
          {zones.length > 1 ? 'Time zone (pick your state or region)' : 'Time zone'}
          <select
            id={`${idPrefix}-tz`}
            value={value?.timeZone || zones[0].timeZone}
            onChange={(e) => onChange({ country: selected.name, timeZone: e.target.value })}
            disabled={zones.length === 1}
            className={`${selectClass} mt-1.5 disabled:opacity-70`}
          >
            {zones.map((z) => (
              <option key={z.timeZone} value={z.timeZone}>{z.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
