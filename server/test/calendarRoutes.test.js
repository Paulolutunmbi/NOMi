const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createCalendarRouter } = require("../src/routes/calendarRoutes");

const start = async (execute, t) => {
  const app = express(); app.use(express.json());
  app.use("/api/calendar", createCalendarRouter({
    authMiddleware: (req, _res, next) => { req.user = { sub: "user-a" }; next(); },
    getUser: async () => ({ _id: "user-a", timeZone: "Africa/Lagos" }),
    execute,
  }));
  const server = app.listen(0); t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}/api/calendar`;
};
const json = (r) => r.json();
const send = (url, method, body) => fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

test("agenda returns the user's events in their time zone", async (t) => {
  const calls = [];
  const base = await start(async (call) => { calls.push(call); return { status: "success", result: { events: [{ id: "e1", kind: "appointment" }] } }; }, t);
  const body = await fetch(`${base}/agenda?from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z`).then(json);
  assert.equal(body.events.length, 1); assert.equal(body.timeZone, "Africa/Lagos");
  assert.ok(calls.every((c) => c.approval === "allow_once" && c.provider === "google" && c.action === "calendar.agenda"));
});

test("agenda rejects bad or oversized ranges", async (t) => {
  const base = await start(async () => { throw new Error("must not run"); }, t);
  for (const q of ["", "from=2026-10-01&to=2026-10-08", "from=2026-10-08T00:00:00Z&to=2026-10-01T00:00:00Z", "from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z"]) {
    assert.equal((await fetch(`${base}/agenda?${q}`)).status, 400, q);
  }
});

test("event edit and cancel go through the executor; invalid edits never reach it", async (t) => {
  const calls = [];
  const base = await start(async (call) => { calls.push(call); return { status: "success", result: { event: { id: "e1", summary: "New" } } }; }, t);
  let r = await send(`${base}/events/e1`, "PATCH", { summary: "New", kind: "appointment" });
  assert.equal(r.status, 200);
  assert.equal(calls[0].action, "calendar.update"); assert.equal(calls[0].payload.eventId, "e1");
  r = await send(`${base}/events/e1`, "PATCH", { attendees: "evil@example.com" });
  assert.equal(r.status, 400);
  r = await send(`${base}/events/e1`, "PATCH", { summary: "  " });
  assert.equal(r.status, 400);
  r = await send(`${base}/events/e1`, "PATCH", { startDateTime: "2026-10-03T15:00", endDateTime: "2026-10-03T14:00" });
  assert.equal(r.status, 400);
  assert.equal(calls.length, 1);
  r = await send(`${base}/events/e1`, "DELETE");
  assert.equal(r.status, 200); assert.equal(calls[1].action, "calendar.delete");
});

test("a stored deny is respected when cancelling", async (t) => {
  const base = await start(async () => ({ status: "denied" }), t);
  assert.equal((await send(`${base}/events/e1`, "DELETE")).status, 403);
});
