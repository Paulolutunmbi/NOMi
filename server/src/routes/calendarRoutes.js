// Direct (non-chat) calendar routes that power the Calendar screen: list the
// agenda, and view/edit/cancel an event the user clicked.
//
// These do not involve the AI planner at all. The person is looking at their
// own item and pressing a button, so each write is treated as an explicit
// one-time approval ("allow_once") and still goes through the same executor
// as chat actions — which honours a stored "deny", writes the audit log, and
// only ever talks to the signed-in user's own Google account.
const express = require("express");
const { findOrCreateFromFirebaseClaims } = require("../services/users/userService");
const { executeAction } = require("../services/actions/actionExecutor");
const { resolveUserTimeZone, isValidTimeZone } = require("../services/calendar/timeZoneResolver");

const GOOGLE_ERRORS = {
  google_reconnect_required: { status: 401, message: "Your Google connection expired. Reconnect Google in Settings." },
  google_insufficient_scope: { status: 403, message: "NOMI needs an extra Google permission for this. Reconnect Google in Settings, then try again." },
  google_rate_limited: { status: 429, message: "Google is busy right now. Try again in a moment." },
  calendar_event_not_found: { status: 404, message: "That item no longer exists. Refresh your calendar." },
  calendar_invalid_request: { status: 400, message: "Some of those details aren't valid." },
};
const fail = (res, status, code, message) => res.status(status).json({ success: false, error: { code, message } });
const EVENT_ID = /^[A-Za-z0-9_@.-]{1,256}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const MAX_WINDOW_MS = 62 * 24 * 60 * 60 * 1000;
const isString = (v, max) => typeof v === "string" && v.length <= max;

const createCalendarRouter = ({ getUser = findOrCreateFromFirebaseClaims, execute = executeAction, authMiddleware } = {}) => {
  const router = express.Router();
  router.use(authMiddleware || require("../middleware/auth"));

  const run = async (user, action, payload, target) => {
    const outcome = await execute({ user, provider: "google", action, payload, target, approval: "allow_once" });
    if (outcome.status === "denied") throw Object.assign(new Error("denied"), { code: "calendar_action_denied" });
    if (outcome.status !== "success") throw Object.assign(new Error("not executed"), { code: "calendar_action_not_executed" });
    return outcome.result;
  };
  const handle = (res, next, error) => {
    if (error?.code === "calendar_action_denied") return fail(res, 403, "CALENDAR_ACTION_DENIED", "You've blocked NOMI from doing this. Change it under Settings → Permissions.");
    const known = GOOGLE_ERRORS[error?.code];
    if (known) return fail(res, known.status, String(error.code).toUpperCase(), known.message);
    return next(error);
  };

  router.get("/agenda", async (req, res, next) => {
    const { from, to } = req.query;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (!isString(from, 40) || !isString(to, 40) || !WITH_OFFSET.test(from) || !WITH_OFFSET.test(to)
      || Number.isNaN(start) || Number.isNaN(end) || end <= start || end - start > MAX_WINDOW_MS) {
      return fail(res, 400, "CALENDAR_RANGE_INVALID", "Choose a valid date range (up to two months).");
    }
    try {
      const user = await getUser(req.user);
      const { events } = await run(user, "calendar.agenda", { timeMin: new Date(start).toISOString(), timeMax: new Date(end).toISOString() }, { type: "calendar", id: null });
      return res.status(200).json({ success: true, events, timeZone: resolveUserTimeZone(user, "") });
    } catch (error) { return handle(res, next, error); }
  });

  router.patch("/events/:eventId", async (req, res, next) => {
    const { eventId } = req.params;
    const b = req.body || {};
    const allowed = ["summary", "description", "location", "startDateTime", "endDateTime", "startDate", "endDate", "kind", "timeZone"];
    if (!EVENT_ID.test(eventId) || Object.keys(b).some((k) => !allowed.includes(k))
      || (b.summary !== undefined && (!isString(b.summary, 500) || !b.summary.trim()))
      || (b.description !== undefined && !isString(b.description, 4000))
      || (b.location !== undefined && !isString(b.location, 500))
      || (b.kind !== undefined && !["event", "appointment"].includes(b.kind))
      || (b.timeZone !== undefined && !isValidTimeZone(b.timeZone))
      || ((b.startDate !== undefined || b.endDate !== undefined) && (!DATE_ONLY.test(b.startDate || "") || !DATE_ONLY.test(b.endDate || "") || b.endDate <= b.startDate))
      || ((b.startDateTime !== undefined || b.endDateTime !== undefined) && (!isString(b.startDateTime, 40) || !isString(b.endDateTime, 40) || !(Date.parse(b.endDateTime) > Date.parse(b.startDateTime))))) {
      return fail(res, 400, "CALENDAR_UPDATE_INVALID", "Check the details — the end must be after the start and the title can't be empty.");
    }
    try {
      const user = await getUser(req.user);
      const result = await run(user, "calendar.update", { eventId, ...b }, { type: "calendar_event", id: eventId });
      return res.status(200).json({ success: true, event: result.event });
    } catch (error) { return handle(res, next, error); }
  });

  router.delete("/events/:eventId", async (req, res, next) => {
    if (!EVENT_ID.test(req.params.eventId)) return fail(res, 400, "CALENDAR_EVENT_INVALID", "That event can't be cancelled.");
    try {
      const user = await getUser(req.user);
      await run(user, "calendar.delete", { eventId: req.params.eventId }, { type: "calendar_event", id: req.params.eventId });
      return res.status(200).json({ success: true });
    } catch (error) { return handle(res, next, error); }
  });

  return router;
};

module.exports = { createCalendarRouter };
