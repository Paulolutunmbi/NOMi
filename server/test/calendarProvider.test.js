const test = require("node:test");
const assert = require("node:assert/strict");
const { createCalendarProvider } = require("../src/services/integrations/calendarProvider");
const { createGoogleIntegration } = require("../src/services/integrations/googleIntegration");

const event = (id = "evt1", overrides = {}) => ({
  id, summary: "Project sync", description: "Discuss roadmap", location: "Zoom",
  start: { dateTime: "2026-10-01T15:00:00Z" }, end: { dateTime: "2026-10-01T15:30:00Z" },
  status: "confirmed", attendees: [{ email: "paul@example.com", responseStatus: "accepted" }],
  htmlLink: "https://calendar.google.com/event?eid=evt1",
  ...overrides,
});
const fakeCalendar = () => {
  const calls = { list: [], get: [], insert: [], patch: [], delete: [], freebusy: [] };
  const api = {
    events: {
      list: async (input) => { calls.list.push(input); return { data: { items: [event("evt1")] } }; },
      get: async (input) => { calls.get.push(input); return { data: event(input.eventId) }; },
      insert: async (input) => { calls.insert.push(input); return { data: event("new-evt", { ...input.requestBody }) }; },
      patch: async (input) => { calls.patch.push(input); return { data: event(input.eventId, { ...input.requestBody }) }; },
      delete: async (input) => { calls.delete.push(input); return { data: {} }; },
    },
    freebusy: { query: async (input) => { calls.freebusy.push(input); return { data: { calendars: { primary: { busy: [{ start: "2026-10-01T09:00:00Z", end: "2026-10-01T10:00:00Z" }] } } } }; } },
  };
  return { api, calls };
};
const providerFor = (fake) => createCalendarProvider({ calendarFactory: () => fake.api });

test("calendar.search returns normalized events and bounds results/time window", async () => {
  const fake = fakeCalendar();
  const result = await providerFor(fake).execute({}, "calendar.search", { query: "sync", maxResults: 999 });
  assert.equal(fake.calls.list[0].maxResults, 50);
  assert.equal(fake.calls.list[0].q, "sync");
  assert.ok(fake.calls.list[0].timeMin && fake.calls.list[0].timeMax, "defaults a time window when none supplied");
  assert.equal(result.events[0].summary, "Project sync");
  assert.equal(result.events[0].id, "evt1");
});

test("calendar.read requires an eventId and returns normalized detail", async () => {
  const fake = fakeCalendar();
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.read", {}), { code: "calendar_invalid_request" });
  const read = await providerFor(fake).execute({}, "calendar.read", { eventId: "evt1" });
  assert.equal(read.event.location, "Zoom");
  assert.equal(read.event.attendees[0].email, "paul@example.com");
});

test("calendar.freebusy requires timeMin/timeMax and returns busy blocks without event IDs", async () => {
  const fake = fakeCalendar();
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.freebusy", {}), { code: "calendar_invalid_request" });
  const result = await providerFor(fake).execute({}, "calendar.freebusy", { timeMin: "2026-10-01T00:00:00Z", timeMax: "2026-10-02T00:00:00Z" });
  assert.equal(result.busy.length, 1);
  assert.equal(JSON.stringify(result).includes("evt"), false);
});

test("calendar.create requires summary/start/end and only includes attendees that are valid emails", async () => {
  const fake = fakeCalendar();
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.create", { summary: "x" }), { code: "calendar_invalid_request" });
  const created = await providerFor(fake).execute({}, "calendar.create", {
    summary: "Kickoff", startDateTime: "2026-10-05T14:00:00Z", endDateTime: "2026-10-05T14:30:00Z",
    attendees: "paul@example.com, not-an-email, paul@example.com",
  });
  assert.equal(fake.calls.insert[0].requestBody.attendees.length, 1);
  assert.equal(fake.calls.insert[0].requestBody.attendees[0].email, "paul@example.com");
  assert.equal(created.event.summary, "Kickoff");
});

test("calendar.create adds Google Meet conference data only when addMeet is requested", async () => {
  const fake = fakeCalendar();
  await providerFor(fake).execute({}, "calendar.create", { summary: "Meet test", startDateTime: "2026-10-05T14:00:00Z", endDateTime: "2026-10-05T14:30:00Z", addMeet: true });
  assert.ok(fake.calls.insert[0].requestBody.conferenceData, "conferenceData should be present when addMeet is true");
  assert.equal(fake.calls.insert[0].conferenceDataVersion, 1);
});

test("calendar.update requires an eventId and at least one field, and rejects an invalid start time", async () => {
  const fake = fakeCalendar();
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.update", { eventId: "evt1" }), { code: "calendar_invalid_request" });
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.update", { eventId: "evt1", startDateTime: "not-a-date" }), { code: "calendar_invalid_request" });
  const updated = await providerFor(fake).execute({}, "calendar.update", { eventId: "evt1", summary: "Renamed" });
  assert.equal(fake.calls.patch[0].eventId, "evt1");
  assert.equal(fake.calls.patch[0].requestBody.summary, "Renamed");
  assert.equal(updated.event.id, "evt1");
});

test("calendar.delete requires an eventId", async () => {
  const fake = fakeCalendar();
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.delete", {}), { code: "calendar_invalid_request" });
  const result = await providerFor(fake).execute({}, "calendar.delete", { eventId: "evt1" });
  assert.equal(fake.calls.delete[0].eventId, "evt1");
  assert.equal(result.deleted, true);
});

test("Calendar and credential failures have safe predictable codes", async () => {
  const fake = fakeCalendar();
  fake.api.events.get = async () => { const error = new Error("not found"); error.code = 404; throw error; };
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.read", { eventId: "gone" }), { code: "calendar_event_not_found" });
  fake.api.events.list = async () => { const error = new Error("quota"); error.code = 429; throw error; };
  await assert.rejects(() => providerFor(fake).execute({}, "calendar.search", {}), { code: "google_rate_limited" });
  const integration = createGoogleIntegration({
    credentialService: { getGoogleAuthForUser: async () => { const error = new Error("not connected"); error.code = "google_not_connected"; throw error; }, refreshGoogleAccessToken: async () => {} },
    calendarProvider: providerFor(fake),
  });
  await assert.rejects(() => integration.execute({ user: { _id: "u1" }, action: "calendar.search", payload: {} }), { code: "google_not_connected" });
});

test("googleIntegration routes Gmail and Calendar actions to the correct provider", async () => {
  const fake = fakeCalendar();
  const gmailCalls = [];
  const integration = createGoogleIntegration({
    credentialService: { getGoogleAuthForUser: async () => ({ auth: { credentials: { access_token: "a" } }, account: { accessTokenExpiresAt: new Date(Date.now() + 100000) } }), refreshGoogleAccessToken: async () => {} },
    gmailProvider: { execute: async (auth, action, payload) => { gmailCalls.push(action); return { ok: true }; } },
    calendarProvider: providerFor(fake),
  });
  await integration.execute({ user: { _id: "u1" }, action: "gmail.search", payload: { query: "x" } });
  await integration.execute({ user: { _id: "u1" }, action: "calendar.search", payload: {} });
  assert.deepEqual(gmailCalls, ["gmail.search"]);
  assert.equal(fake.calls.list.length, 1);
  assert.equal(integration.capabilities.includes("gmail.search"), true);
  assert.equal(integration.capabilities.includes("calendar.create"), true);
});
