const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyText } = require("../src/services/privacy/dataClassificationService");
const { redactForAI, restorePlaceholders, externalAIPayload } = require("../src/services/privacy/privacyService");

test("classifies emails, phones, credentials, valid cards, and avoids number false positives", () => {
  const findings = classifyText("Email a@b.com, call +1 555-123-4567, use sk-abcdefghijklmnopqrstuvwxyz, card 4111 1111 1111 1111, order 20240101");
  assert.deepEqual(findings.map((item) => item.type), ["EMAIL", "PHONE", "API_KEY", "CARD"]);
});

test("redacts multiple values with stable unique placeholders and internally restores them", () => {
  const text = "Send John at john@example.com a note; copy jane@example.com and call 555-123-4567.";
  const result = redactForAI(text, { protectedValues: ["John"] });
  assert.match(result.redactedText, /\[PERSON_1\].*\[EMAIL_1\].*\[EMAIL_2\].*\[PHONE_1\]/);
  assert.equal(result.redactedText.includes("john@example.com"), false);
  assert.equal(restorePlaceholders({ recipient: "[EMAIL_1]" }, result.mappings).recipient, "john@example.com");
  const payload = externalAIPayload({ userRequest: result.redactedText });
  assert.equal(JSON.stringify(payload).includes("john@example.com"), false);
  assert.equal(JSON.stringify(payload).includes("John"), false);
});

test("names are not classified unless explicitly protected", () => {
  assert.equal(redactForAI("Ask John about the report").redactedText, "Ask John about the report");
});
