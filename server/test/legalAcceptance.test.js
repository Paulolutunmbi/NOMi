const test = require("node:test");
const assert = require("node:assert/strict");
const { createLegalAcceptanceMiddleware } = require("../src/middleware/legalAcceptance");

const CURRENT_VERSION = "2026-10-05";
const callMiddleware = async (acceptance, path = "/api/ai/execute") => {
  let response;
  let continued = false;
  const middleware = createLegalAcceptanceMiddleware({
    currentVersion: CURRENT_VERSION,
    getUser: async () => ({ legalAcceptance: acceptance }),
  });
  await middleware(
    { originalUrl: path, path, user: { uid: "u1" } },
    { status(code) { response = { status: code }; return this; }, json(body) { response.body = body; return this; } },
    () => { continued = true; },
  );
  return { response, continued };
};

test("new users without an acceptance are blocked", async () => {
  const { response, continued } = await callMiddleware(null);
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "LEGAL_ACCEPTANCE_REQUIRED");
  assert.equal(continued, false);
});

test("existing users without a legal record are blocked the same way", async () => {
  const { response } = await callMiddleware(undefined);
  assert.equal(response.body.code, "LEGAL_ACCEPTANCE_REQUIRED");
});

test("accepting the current terms and privacy version permits protected operations", async () => {
  const { response, continued } = await callMiddleware({ termsVersion: CURRENT_VERSION, privacyVersion: CURRENT_VERSION, acceptedAt: new Date() });
  assert.equal(response, undefined);
  assert.equal(continued, true);
});

test("acceptance of an older version requires acceptance again", async () => {
  const { response, continued } = await callMiddleware({ termsVersion: "2026-10-04", privacyVersion: "2026-10-04", acceptedAt: new Date() });
  assert.equal(response.body.code, "LEGAL_ACCEPTANCE_REQUIRED");
  assert.equal(continued, false);
});

test("legal status and acceptance routes are exempt from the gate", async () => {
  for (const path of ["/api/auth/me", "/api/auth/legal-acceptance", "/api/auth/logout"]) {
    const { response, continued } = await callMiddleware(null, path);
    assert.equal(response, undefined);
    assert.equal(continued, true);
  }
});
