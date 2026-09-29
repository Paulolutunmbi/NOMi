import { getAllCountries, getTimezonesForCountry } from 'countries-and-timezones'

// Every country, A–Z by name.
export const COUNTRIES = Object.values(getAllCountries())
  .map(({ id, name }) => ({ id, name }))
  .sort((a, b) => a.name.localeCompare(b.name))

export function findCountryByName(name) {
  if (!name) return null
  const wanted = String(name).trim().toLowerCase()
  return COUNTRIES.find((c) => c.name.toLowerCase() === wanted) || null
}

// "UTC+1" / "UTC+5:30" for the zone's offset right now (respects daylight saving).
function currentOffsetLabel(timeZone) {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value || 'GMT'
    return part === 'GMT' ? 'UTC' : part.replace('GMT', 'UTC').replace(/:00$/, '').replace(/([+-])0(\d)/, '$1$2')
  } catch {
    return ''
  }
}

// The real zones a country uses (aliases removed), ordered west→east, each
// labelled like "Chicago (UTC-5)" so people can pick their own state/region.
export function zonesForCountry(countryId) {
  if (!countryId) return []
  return getTimezonesForCountry(countryId)
    .filter((z) => !z.aliasOf)
    .sort((a, b) => a.utcOffset - b.utcOffset || a.name.localeCompare(b.name))
    .map((z) => ({
      timeZone: z.name,
      label: `${z.name.split('/').slice(1).join(' / ').replace(/_/g, ' ') || z.name} (${currentOffsetLabel(z.name)})`,
    }))
}
