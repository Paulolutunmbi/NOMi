const test = require("node:test");
const assert = require("node:assert/strict");
const { validateIntent } = require("../src/services/ai/intentValidator");

const KEYS = ["body", "maxResults", "messageId", "query", "recipient", "subject", "eventId", "summary", "description", "location", "startDateTime", "endDateTime", "timeZone", "attendees", "timeMin", "timeMax", "addMeet"];
const reschedule = (startDateTime, endDateTime = null) => ({
  action: "calendar.update",
  parameters: { ...Object.fromEntries(KEYS.map((k) => [k, null])), eventId: "evt1", startDateTime, endDateTime },
});
const check = (intent) => validateIntent(intent, { trustedCalendarEventIds: ["evt1"] });

test("near-miss datetimes from the model are normalised, not rejected", () => {
  const cases = [
    ["2026-10-03T10:00:00+01:00", "2026-10-03T10:00:00+01:00"],
    ["2026-10-03 10:00", "2026-10-03T10:00"],
    ["2026-10-03T10:00:00+0100", "2026-10-03T10:00:00+01:00"],
    ["2026-10-03T9:00", "2026-10-03T09:00"],
    ["2026-10-03 10:00 PM", "2026-10-03T22:00"],
    ["2026-10-03T10am", "2026-10-03T10:00"],
  ];
  for (const [input, expected] of cases) {
    const result = check(reschedule(input, "2026-10-03 11:00"));
    assert.equal(result.valid, true, input);
    assert.equal(result.intent.parameters.startDateTime, expected, input);
    assert.equal(result.intent.parameters.endDateTime, "2026-10-03T11:00", input);
  }
});

test("values that are not a real date and time are still rejected", () => {
  for (const input of ["tomorrow 10am", "2026-10-03", "2026-10-03T13:00 PM", "next friday"]) {
    assert.deepEqual(check(reschedule(input)), { valid: false, reason: "invalid_startDateTime" }, input);
  }
});
