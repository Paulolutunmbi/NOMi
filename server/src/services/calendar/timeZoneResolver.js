// Deterministic time zone handling for calendar events. The AI model is never
// trusted to pick a time zone: it only proposes a wall-clock time ("10:00"),
// and this module decides which zone that wall-clock time belongs to, from
// either what the user explicitly said or what they picked in the prompt.

// Shown as one-tap options when NOMI has to ask.
const COMMON_ZONES = Object.freeze([
  { timeZone: "UTC", label: "UTC" },
  { timeZone: "Africa/Lagos", label: "WAT · Lagos, Nigeria" },
  { timeZone: "Africa/Maputo", label: "CAT · Central Africa" },
  { timeZone: "Africa/Nairobi", label: "EAT · Nairobi, East Africa" },
  { timeZone: "Africa/Johannesburg", label: "SAST · South Africa" },
  { timeZone: "Europe/London", label: "London, UK" },
  { timeZone: "Europe/Paris", label: "CET · Paris, Berlin" },
  { timeZone: "America/New_York", label: "Eastern · New York" },
  { timeZone: "America/Los_Angeles", label: "Pacific · Los Angeles" },
  { timeZone: "Asia/Kolkata", label: "IST · India" },
  { timeZone: "Asia/Dubai", label: "Gulf · Dubai" },
]);

const ABBREVIATIONS = Object.freeze({
  utc: "UTC", gmt: "Europe/London", wat: "Africa/Lagos", cat: "Africa/Maputo", eat: "Africa/Nairobi",
  sast: "Africa/Johannesburg", cet: "Europe/Paris", cest: "Europe/Paris", eet: "Europe/Athens", bst: "Europe/London",
  est: "America/New_York", edt: "America/New_York", cst: "America/Chicago", cdt: "America/Chicago",
  mst: "America/Denver", mdt: "America/Denver", pst: "America/Los_Angeles", pdt: "America/Los_Angeles",
  ist: "Asia/Kolkata", pkt: "Asia/Karachi", gst: "Asia/Dubai", sgt: "Asia/Singapore", hkt: "Asia/Hong_Kong",
  jst: "Asia/Tokyo", kst: "Asia/Seoul", aest: "Australia/Sydney", aedt: "Australia/Sydney", nzst: "Pacific/Auckland",
});

// Countries that use a single time zone (or one that is right for nearly
// everyone there). Names are lower-case; several spellings map to one zone.
const SINGLE_ZONE_COUNTRIES = {
  "Africa/Lagos": ["nigeria", "benin", "niger", "cameroon", "gabon", "chad", "central african republic", "equatorial guinea", "angola"],
  "Africa/Accra": ["ghana", "liberia", "senegal", "mali", "burkina faso", "sierra leone", "togo", "gambia", "guinea", "mauritania", "iceland"],
  "Africa/Abidjan": ["ivory coast", "cote d'ivoire", "côte d'ivoire"],
  "Africa/Nairobi": ["kenya", "ethiopia", "somalia", "tanzania", "uganda", "djibouti", "eritrea"],
  "Africa/Maputo": ["mozambique", "zambia", "zimbabwe", "malawi", "botswana", "rwanda", "burundi", "namibia", "south sudan"],
  "Africa/Johannesburg": ["south africa", "lesotho", "eswatini", "swaziland"],
  "Africa/Cairo": ["egypt"], "Africa/Casablanca": ["morocco"], "Africa/Algiers": ["algeria"], "Africa/Tunis": ["tunisia"], "Africa/Tripoli": ["libya"],
  "Europe/London": ["united kingdom", "uk", "england", "scotland", "wales", "great britain", "britain", "northern ireland"],
  "Europe/Dublin": ["ireland"], "Europe/Lisbon": ["portugal"], "Europe/Paris": ["france"], "Europe/Berlin": ["germany"],
  "Europe/Madrid": ["spain"], "Europe/Rome": ["italy"], "Europe/Amsterdam": ["netherlands", "holland"], "Europe/Brussels": ["belgium"],
  "Europe/Zurich": ["switzerland"], "Europe/Vienna": ["austria"], "Europe/Stockholm": ["sweden"], "Europe/Oslo": ["norway"],
  "Europe/Copenhagen": ["denmark"], "Europe/Helsinki": ["finland"], "Europe/Warsaw": ["poland"], "Europe/Prague": ["czech republic", "czechia"],
  "Europe/Budapest": ["hungary"], "Europe/Athens": ["greece"], "Europe/Bucharest": ["romania"], "Europe/Kyiv": ["ukraine"],
  "Europe/Istanbul": ["turkey", "türkiye", "turkiye"],
  "Asia/Kolkata": ["india"], "Asia/Karachi": ["pakistan"], "Asia/Dhaka": ["bangladesh"], "Asia/Colombo": ["sri lanka"], "Asia/Kathmandu": ["nepal"],
  "Asia/Shanghai": ["china"], "Asia/Tokyo": ["japan"], "Asia/Seoul": ["south korea", "korea"], "Asia/Singapore": ["singapore"],
  "Asia/Kuala_Lumpur": ["malaysia"], "Asia/Bangkok": ["thailand"], "Asia/Ho_Chi_Minh": ["vietnam"], "Asia/Manila": ["philippines"],
  "Asia/Hong_Kong": ["hong kong"], "Asia/Taipei": ["taiwan"],
  "Asia/Riyadh": ["saudi arabia"], "Asia/Dubai": ["united arab emirates", "uae", "oman"], "Asia/Qatar": ["qatar"], "Asia/Kuwait": ["kuwait"],
  "Asia/Jerusalem": ["israel"], "Asia/Tehran": ["iran"], "Asia/Baghdad": ["iraq"], "Asia/Amman": ["jordan"], "Asia/Beirut": ["lebanon"],
  "America/Bogota": ["colombia"], "America/Lima": ["peru"], "America/Santiago": ["chile"], "America/Argentina/Buenos_Aires": ["argentina"],
  "America/Caracas": ["venezuela"], "America/Havana": ["cuba"], "America/Jamaica": ["jamaica"], "America/Mexico_City": ["mexico"],
  "Pacific/Auckland": ["new zealand"],
};

// Countries with several zones: NOMI offers the realistic choices instead of guessing.
const MULTI_ZONE_COUNTRIES = {
  "united states": ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
  usa: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
  us: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"],
  america: ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles"],
  canada: ["America/Toronto", "America/Winnipeg", "America/Edmonton", "America/Vancouver", "America/Halifax"],
  brazil: ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza"],
  australia: ["Australia/Sydney", "Australia/Adelaide", "Australia/Perth", "Australia/Brisbane"],
  russia: ["Europe/Moscow", "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Vladivostok"],
  indonesia: ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"],
  "democratic republic of the congo": ["Africa/Kinshasa", "Africa/Lubumbashi"], drc: ["Africa/Kinshasa", "Africa/Lubumbashi"],
};

const COUNTRY_LOOKUP = new Map();
for (const [timeZone, names] of Object.entries(SINGLE_ZONE_COUNTRIES)) for (const name of names) COUNTRY_LOOKUP.set(name, timeZone);

const IANA_SHAPE = /^[A-Za-z]+(?:[_+-]?[A-Za-z0-9]+)*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const isValidTimeZone = (value) => {
  if (typeof value !== "string" || value.length > 64 || !(value === "UTC" || (value.includes("/") && IANA_SHAPE.test(value)))) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
};

let cityIndex = null;
const cities = () => {
  if (cityIndex) return cityIndex;
  cityIndex = new Map();
  let zones = [];
  try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = []; }
  for (const zone of zones) {
    const city = zone.split("/").pop().replace(/_/g, " ").toLowerCase();
    if (!cityIndex.has(city)) cityIndex.set(city, zone);
  }
  return cityIndex;
};

// "Africa/Lagos" -> "Lagos (WAT, UTC+1)". Uses the zone's real offset on the
// given date, so daylight saving is reflected.
const describeTimeZone = (timeZone, at = new Date()) => {
  if (timeZone === "UTC") return "UTC";
  try {
    const short = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "";
    const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value || "";
    const utc = offset === "GMT" ? "UTC" : offset.replace("GMT", "UTC").replace(/:00$/, "").replace(/([+-])0(\d)/, "$1$2");
    const place = timeZone === "UTC" ? "" : `${timeZone.split("/").pop().replace(/_/g, " ")} `;
    const abbr = /^GMT[+-]/.test(short) || short === utc ? "" : `${short}, `;
    return `${place}(${abbr}${utc})`.trim();
  } catch { return timeZone; }
};

const optionFor = (timeZone) => ({ timeZone, label: (COMMON_ZONES.find((z) => z.timeZone === timeZone)?.label) || describeTimeZone(timeZone) });

// What the user typed in answer to "which time zone?". Accepts an
// abbreviation (WAT, CAT, UTC), an IANA name, a city, or a country.
const resolveTimeZone = (input) => {
  const raw = String(input || "").trim();
  if (!raw || raw.length > 80) return { status: "unknown" };
  const cleaned = raw.toLowerCase().replace(/\btime\s*zone\b|\btime\b|\bthe\b/g, " ").replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return { status: "unknown" };
  if (isValidTimeZone(raw)) return { status: "ok", timeZone: raw };
  if (ABBREVIATIONS[cleaned]) return { status: "ok", timeZone: ABBREVIATIONS[cleaned] };
  if (MULTI_ZONE_COUNTRIES[cleaned]) return { status: "choose", options: MULTI_ZONE_COUNTRIES[cleaned].map(optionFor) };
  if (COUNTRY_LOOKUP.has(cleaned)) return { status: "ok", timeZone: COUNTRY_LOOKUP.get(cleaned) };
  const city = cities().get(cleaned);
  if (city) return { status: "ok", timeZone: city };
  const underscored = raw.replace(/\s+/g, "_");
  const byName = [...cities().values()].find((zone) => zone.toLowerCase().endsWith(`/${underscored.toLowerCase()}`));
  if (byName) return { status: "ok", timeZone: byName };
  return { status: "unknown" };
};

// A time zone the user stated inside their scheduling request, e.g.
// "10am WAT", "3 pm UTC", "at 9:30 Lagos time". Deliberately narrow so an
// ordinary word ("my cat") is never mistaken for a zone.
const TIME_THEN_ZONE = /\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*\(?\b([A-Za-z]{2,5})\b\)?(?=[\s.,;!?]|$)/g;
const PLACE_TIME = /\b(?:in\s+)?([A-Za-z][A-Za-z' ]{1,30}?)\s+time\b/gi;
const timeZoneFromText = (message) => {
  const text = String(message || "");
  for (const match of text.matchAll(TIME_THEN_ZONE)) {
    const abbr = match[1].toLowerCase();
    if (ABBREVIATIONS[abbr] && !["am", "pm"].includes(abbr)) return ABBREVIATIONS[abbr];
  }
  for (const match of text.matchAll(PLACE_TIME)) {
    const words = match[1].trim().split(/\s+/);
    for (let take = Math.min(2, words.length); take >= 1; take -= 1) {
      const candidate = words.slice(-take).join(" ");
      const found = resolveTimeZone(candidate);
      if (found.status === "ok" && !["local", "my", "your", "meeting", "same", "real"].includes(candidate.toLowerCase())) return found.timeZone;
    }
  }
  return null;
};

// Wall-clock helpers. The model proposes "2026-09-29T10:00:00" (possibly with
// a stray Z or offset from the UTC server clock). The offset is dropped so the
// number the user asked for ("10") is kept, and the chosen zone is attached.
const stripOffset = (value) => String(value || "").trim().replace(/(Z|[+-]\d{2}:\d{2})$/i, "").replace(/\.\d+$/, "").replace(/T(\d{2}:\d{2})$/, "T$1:00");
const pad = (n) => String(n).padStart(2, "0");
// Adds a duration to a wall-clock string, treating the digits as plain
// numbers (no real time zone involved) so a meeting's length is preserved
// exactly regardless of which zone it's actually booked in.
const addMillisWallClock = (wallClock, ms) => {
  const m = String(wallClock).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) + ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const addHoursWallClock = (wallClock, hours) => addMillisWallClock(wallClock, hours * 3600 * 1000);

// "Tue 29 Sep, 10:00" for the confirmation card, from the wall-clock string.
const formatWallClock = (wallClock) => {
  const m = String(wallClock).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(wallClock || "");
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
};

// Used where NOMI no longer offers a choice (sign-up, Settings): countries
// with several zones get their most representative one rather than a prompt.
const defaultTimeZoneForCountry = (input) => {
  const resolved = resolveTimeZone(input);
  if (resolved.status === "ok") return resolved.timeZone;
  if (resolved.status === "choose") return resolved.options[0]?.timeZone || null;
  return null;
};

module.exports = {
  addMillisWallClock,
  defaultTimeZoneForCountry, COMMON_ZONES, isValidTimeZone, resolveTimeZone, timeZoneFromText, describeTimeZone, optionFor, stripOffset, addHoursWallClock, formatWallClock };
