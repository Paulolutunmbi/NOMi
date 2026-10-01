// Google Calendar provider. Mirrors gmailProvider.js's shape and trust rules:
// the provider only ever executes against the authenticated user's own
// calendar, never invents or trusts an event ID from outside its own prior
// search/read results, and never returns raw provider errors to the caller.

const SUPPORTED_ACTIONS = new Set([
  "calendar.search", "calendar.read", "calendar.freebusy", "calendar.create", "calendar.update", "calendar.delete",
]);

const MAX_RESULTS = 50;
const MAX_QUERY_LENGTH = 500;
const MAX_TEXT_LENGTH = 4000;
const MAX_SHORT_TEXT_LENGTH = 500;
const EMAIL = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const DEFAULT_SEARCH_WINDOW_DAYS = 30;

const safeError = (code, message) => Object.assign(new Error(message), { code, safe: true });

const normalizeGoogleError = (error, { eventNotFound = false } = {}) => {
  if (error?.safe) return error;
  // Google client errors can contain OAuth request headers and credentials.
  // Log only the diagnostic fields needed to identify the API failure.
  const googleError = error?.response?.data?.error;
  const details = {
    status: Number(error?.code || error?.response?.status || error?.status) || null,
    code: typeof error?.code === "string" ? error.code : null,
    message: typeof error?.message === "string" ? error.message.slice(0, 500) : null,
    googleMessage: typeof googleError?.message === "string" ? googleError.message.slice(0, 500) : null,
    reasons: Array.isArray(googleError?.errors)
      ? googleError.errors.map(({ reason, domain }) => ({ reason, domain }))
      : [],
    request: error?.response?.config ? {
      method: error.response.config.method,
      url: error.response.config.url,
    } : undefined,
  };
  console.error("[Google Calendar] API request failed:", JSON.stringify(details));
  const status = Number(error?.code || error?.response?.status || error?.status);
  const reason = String(googleError?.errors?.[0]?.reason || googleError?.message || error?.message || "").toLowerCase();
  if (eventNotFound && status === 404) return safeError("calendar_event_not_found", "The selected calendar event was not found");
  if (status === 401 || reason.includes("invalid_grant") || reason.includes("invalid credentials")) {
    return safeError("google_reconnect_required", "Google connection needs to be reconnected");
  }
  if (status === 403 && (reason.includes("insufficient") || reason.includes("scope") || reason.includes("permission"))) {
    return safeError("google_insufficient_scope", "Google account does not have the required permission");
  }
  if (status === 429 || reason.includes("rate limit") || reason.includes("quota")) {
    return safeError("google_rate_limited", "Google is temporarily rate limited");
  }
  return safeError("google_api_error", "Google API request could not be completed");
};

const text = (value, max = MAX_SHORT_TEXT_LENGTH) => typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim().slice(0, max) : "";
const eventId = (value) => typeof value === "string" && value.trim() && value.length <= 1024 ? value.trim() : null;
const isoDateTime = (value) => typeof value === "string" && ISO_DATETIME.test(value.trim()) ? value.trim() : null;
const validEmail = (value) => EMAIL.test(value || "");
// Attendees arrive as a single comma/semicolon-separated string (kept
// consistent with the AI intent schema's flat string parameters); each token
// must already be a valid, explicitly-supplied address by the time it
// reaches the provider — see intentValidator's attendee checks.
const parseAttendees = (value) => {
  if (typeof value !== "string" || !value.trim()) return [];
  return [...new Set(value.split(/[,;]/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))]
    .filter(validEmail)
    .slice(0, 20)
    .map((email) => ({ email }));
};

const normalizeEventTime = (time) => {
  if (!time) return null;
  return text(time.dateTime || time.date, 100);
};
const normalizeAttendee = (attendee) => ({
  email: text(attendee?.email, 320) || null,
  responseStatus: text(attendee?.responseStatus, 30) || null,
});
const meetLinkFrom = (event) => {
  const entryPoints = event?.conferenceData?.entryPoints || [];
  const video = entryPoints.find((entry) => entry.entryPointType === "video");
  return text(video?.uri, 500) || null;
};
const normalizeEvent = (event) => ({
  id: text(event?.id, 1024),
  summary: text(event?.summary, MAX_SHORT_TEXT_LENGTH) || null,
  description: text(event?.description, MAX_TEXT_LENGTH) || null,
  location: text(event?.location, MAX_SHORT_TEXT_LENGTH) || null,
  start: normalizeEventTime(event?.start),
  end: normalizeEventTime(event?.end),
  status: text(event?.status, 30) || null,
  attendees: Array.isArray(event?.attendees) ? event.attendees.slice(0, 20).map(normalizeAttendee) : [],
  meetLink: meetLinkFrom(event),
  htmlLink: text(event?.htmlLink, 1000) || null,
});

const HAS_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;

const zoneOffsetMinutes = (timeZone, date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
};

// Google's list/freebusy endpoints need an absolute instant. Wall-clock
// strings are interpreted in the user's zone; ones with an offset pass through.
const rangeDateTime = (value, timeZone) => {
  const v = isoDateTime(value);
  if (!v) return null;
  if (HAS_OFFSET.test(v)) return v;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const zone = timeZone || "Africa/Lagos";
  let off = zoneOffsetMinutes(zone, new Date(guess));
  off = zoneOffsetMinutes(zone, new Date(guess - off * 60000));
  return new Date(guess - off * 60000).toISOString();
};

const createCalendarProvider = ({ calendarFactory } = {}) => {
  const clientFor = (auth) => (calendarFactory ? calendarFactory(auth) : require("googleapis").google.calendar({ version: "v3", auth }));
  const getEvent = async (calendar, id) => {
    try { return (await calendar.events.get({ calendarId: "primary", eventId: id })).data; }
    catch (error) { throw normalizeGoogleError(error, { eventNotFound: true }); }
  };

  const execute = async (auth, action, payload = {}) => {
    if (!SUPPORTED_ACTIONS.has(action)) throw safeError("calendar_invalid_request", "Unsupported Calendar action");
    const calendar = clientFor(auth);
    try {
      if (action === "calendar.search") {
        const query = payload.query ? text(payload.query, MAX_QUERY_LENGTH) : undefined;
        const now = Date.now();
        const timeMin = rangeDateTime(payload.timeMin, payload.timeZone) || new Date(now).toISOString();
        const timeMax = rangeDateTime(payload.timeMax, payload.timeZone) || new Date(now + DEFAULT_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const requested = payload.maxResults === undefined ? 10 : Number(payload.maxResults);
        if (!Number.isInteger(requested) || requested < 1) throw safeError("calendar_invalid_request", "maxResults must be between 1 and 50");
        const maxResults = Math.min(requested, MAX_RESULTS);
        const listed = await calendar.events.list({
          calendarId: "primary", q: query, timeMin, timeMax, maxResults,
          singleEvents: true, orderBy: "startTime",
        });
        const events = (listed.data.items || []).map(normalizeEvent);
        return { events, auditMetadata: { count: events.length, operation: "calendar_search" } };
      }
      if (action === "calendar.read") {
        const id = eventId(payload.eventId);
        if (!id) throw safeError("calendar_invalid_request", "A calendar event ID is required");
        const event = await getEvent(calendar, id);
        return { event: normalizeEvent(event), auditMetadata: { operation: "calendar_read" } };
      }
      if (action === "calendar.freebusy") {
        const timeMin = rangeDateTime(payload.timeMin, payload.timeZone);
        const timeMax = rangeDateTime(payload.timeMax, payload.timeZone);
        if (!timeMin || !timeMax) throw safeError("calendar_invalid_request", "A valid timeMin and timeMax are required");
        const response = await calendar.freebusy.query({ requestBody: { timeMin, timeMax, items: [{ id: "primary" }] } });
        const busy = (response.data?.calendars?.primary?.busy || []).slice(0, 100)
          .map((block) => ({ start: text(block.start, 100), end: text(block.end, 100) }));
        return { busy, auditMetadata: { operation: "calendar_freebusy", count: busy.length } };
      }
      if (action === "calendar.create") {
        const summary = text(payload.summary, MAX_SHORT_TEXT_LENGTH);
        const start = isoDateTime(payload.startDateTime);
        const end = isoDateTime(payload.endDateTime);
        if (!summary) throw safeError("calendar_invalid_request", "A valid event title is required");
        if (!start || !end) throw safeError("calendar_invalid_request", "A valid start and end time are required");
        const attendees = parseAttendees(payload.attendees);
        const requestBody = {
          summary,
          description: text(payload.description, MAX_TEXT_LENGTH) || undefined,
          location: text(payload.location, MAX_SHORT_TEXT_LENGTH) || undefined,
          start: { dateTime: start, ...(payload.timeZone ? { timeZone: text(payload.timeZone, 100) } : {}) },
          end: { dateTime: end, ...(payload.timeZone ? { timeZone: text(payload.timeZone, 100) } : {}) },
          ...(attendees.length ? { attendees } : {}),
          ...(payload.addMeet ? { conferenceData: { createRequest: { requestId: `nomi-${Date.now()}` } } } : {}),
        };
        const response = await calendar.events.insert({
          calendarId: "primary", requestBody, conferenceDataVersion: payload.addMeet ? 1 : 0, sendUpdates: attendees.length ? "all" : "none",
        });
        return { event: normalizeEvent(response.data), auditMetadata: { operation: "calendar_event_created" } };
      }
      if (action === "calendar.update") {
        const id = eventId(payload.eventId);
        if (!id) throw safeError("calendar_invalid_request", "A calendar event ID is required");
        const requestBody = {};
        if (payload.summary !== undefined && payload.summary !== null) requestBody.summary = text(payload.summary, MAX_SHORT_TEXT_LENGTH);
        if (payload.description !== undefined && payload.description !== null) requestBody.description = text(payload.description, MAX_TEXT_LENGTH);
        if (payload.location !== undefined && payload.location !== null) requestBody.location = text(payload.location, MAX_SHORT_TEXT_LENGTH);
        if (payload.startDateTime) {
          const start = isoDateTime(payload.startDateTime);
          if (!start) throw safeError("calendar_invalid_request", "A valid start time is required");
          requestBody.start = { dateTime: start, ...(payload.timeZone ? { timeZone: text(payload.timeZone, 100) } : {}) };
        }
        if (payload.endDateTime) {
          const end = isoDateTime(payload.endDateTime);
          if (!end) throw safeError("calendar_invalid_request", "A valid end time is required");
          requestBody.end = { dateTime: end, ...(payload.timeZone ? { timeZone: text(payload.timeZone, 100) } : {}) };
        }
        if (payload.attendees !== undefined && payload.attendees !== null) {
          // "Add X to the meeting" must add, not replace: keep everyone who
          // is already invited (with their responses) and append the new people.
          const existing = (await getEvent(calendar, id)).attendees || [];
          const known = new Set(existing.map((entry) => String(entry.email || "").toLowerCase()));
          const added = parseAttendees(payload.attendees).filter((entry) => !known.has(entry.email));
          requestBody.attendees = [...existing.map((entry) => ({ email: entry.email, ...(entry.responseStatus ? { responseStatus: entry.responseStatus } : {}), ...(entry.optional ? { optional: true } : {}) })), ...added];
        }
        if (payload.addMeet) requestBody.conferenceData = { createRequest: { requestId: `nomi-${Date.now()}` } };
        if (!Object.keys(requestBody).length) throw safeError("calendar_invalid_request", "At least one field to update is required");
        const response = await calendar.events.patch({
          calendarId: "primary", eventId: id, requestBody, conferenceDataVersion: payload.addMeet ? 1 : 0, sendUpdates: requestBody.attendees?.length ? "all" : "none",
        }).catch((error) => { throw normalizeGoogleError(error, { eventNotFound: true }); });
        return { event: normalizeEvent(response.data), auditMetadata: { operation: "calendar_event_updated" } };
      }
      // calendar.delete
      const id = eventId(payload.eventId);
      if (!id) throw safeError("calendar_invalid_request", "A calendar event ID is required");
      await calendar.events.delete({ calendarId: "primary", eventId: id, sendUpdates: "all" })
        .catch((error) => { throw normalizeGoogleError(error, { eventNotFound: true }); });
      return { deleted: true, auditMetadata: { operation: "calendar_event_deleted" } };
    } catch (error) { throw normalizeGoogleError(error); }
  };

  return { execute };
};

module.exports = { createCalendarProvider, normalizeGoogleError, SUPPORTED_ACTIONS, parseAttendees, normalizeEvent };
