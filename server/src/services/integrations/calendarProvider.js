// Google Calendar provider. Mirrors gmailProvider.js's shape and trust rules:
// the provider only ever executes against the authenticated user's own
// calendar, never invents or trusts an event ID from outside its own prior
// search/read results, and never returns raw provider errors to the caller.

const { addHoursWallClock, stripOffset } = require("../calendar/timeZoneResolver");

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
  const status = Number(error?.code || error?.response?.status || error?.status);
  const reason = String(error?.response?.data?.error?.errors?.[0]?.reason || error?.message || "").toLowerCase();
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
        const timeMin = isoDateTime(payload.timeMin) || new Date(now).toISOString();
        const timeMax = isoDateTime(payload.timeMax) || new Date(now + DEFAULT_SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
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
        const timeMin = isoDateTime(payload.timeMin);
        const timeMax = isoDateTime(payload.timeMax);
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
        let existingEvent = null;
        const loadExisting = async () => (existingEvent ||= await getEvent(calendar, id));
        const zone = payload.timeZone ? { timeZone: text(payload.timeZone, 100) } : {};
        let newStart = null;
        let newEnd = null;
        if (payload.startDateTime) {
          newStart = isoDateTime(payload.startDateTime);
          if (!newStart) throw safeError("calendar_invalid_request", "A valid start time is required");
          requestBody.start = { dateTime: newStart, ...zone };
        }
        if (payload.endDateTime) {
          newEnd = isoDateTime(payload.endDateTime);
          if (!newEnd) throw safeError("calendar_invalid_request", "A valid end time is required");
          requestBody.end = { dateTime: newEnd, ...zone };
        }
        // Rescheduling: when only the start moves, keep the meeting the same
        // length instead of leaving the old end time behind (which would put
        // the end before the new start, or silently change the duration).
        if (newStart && !newEnd) {
          const current = await loadExisting();
          const oldStart = Date.parse(current.start?.dateTime || "");
          const oldEnd = Date.parse(current.end?.dateTime || "");
          const hours = Number.isFinite(oldStart) && Number.isFinite(oldEnd) && oldEnd > oldStart ? (oldEnd - oldStart) / 3600000 : 1;
          const shiftedEnd = addHoursWallClock(stripOffset(newStart), hours);
          if (!shiftedEnd) throw safeError("calendar_invalid_request", "A valid start time is required");
          requestBody.end = { dateTime: shiftedEnd, ...zone };
        }
        if (newStart && newEnd && stripOffset(newEnd) <= stripOffset(newStart)) {
          throw safeError("calendar_invalid_request", "The end time must be after the start time");
        }
        if (payload.attendees !== undefined && payload.attendees !== null) {
          // "Add X to the meeting" must add, not replace: keep everyone who
          // is already invited (with their responses) and append the new people.
          const existing = (await loadExisting()).attendees || [];
          const known = new Set(existing.map((entry) => String(entry.email || "").toLowerCase()));
          const added = parseAttendees(payload.attendees).filter((entry) => !known.has(entry.email));
          requestBody.attendees = [...existing.map((entry) => ({ email: entry.email, ...(entry.responseStatus ? { responseStatus: entry.responseStatus } : {}), ...(entry.optional ? { optional: true } : {}) })), ...added];
        }
        if (payload.addMeet) requestBody.conferenceData = { createRequest: { requestId: `nomi-${Date.now()}` } };
        if (!Object.keys(requestBody).length) throw safeError("calendar_invalid_request", "At least one field to update is required");
        // Tell guests when people are added or when the time moves.
        const timeChanged = Boolean(requestBody.start || requestBody.end);
        const notify = requestBody.attendees?.length ? true : timeChanged && (await loadExisting()).attendees?.length > 0;
        const response = await calendar.events.patch({
          calendarId: "primary", eventId: id, requestBody, conferenceDataVersion: payload.addMeet ? 1 : 0, sendUpdates: notify ? "all" : "none",
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
