const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");

// authRoutes.js pulls in ../config/firebase at load time (for its default
// export), which throws without this env var — set here so this file can be
// run on its own, the same way the app's own start scripts already do via .env.
process.env.GOOGLE_APPLICATION_CREDENTIALS ||= path.join(__dirname, "..", "credentials", "firebase-service-account.json");

const { createAuthRouter } = require("../src/routes/authRoutes");

const makeApp = ({ users = [], authMiddleware } = {}) => {
  const findUser = (uid) => users.find((u) => u.firebaseUid === uid);
  const getUser = async (claims) => {
    let user = findUser(claims.uid);
    if (!user) {
      user = { firebaseUid: claims.uid, email: claims.email || null, displayName: claims.name || null, country: null, timeZone: null, legalAcceptance: null, async save() {} };
      users.push(user);
    }
    return user;
  };
  const firebaseAdmin = { auth: () => ({ verifyIdToken: async () => ({ uid: "u1" }) }) };
  const connectedAccountModel = { find: () => ({ select: () => ({ lean: async () => [] }) }) };
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({
    firebaseAdmin,
    getUser,
    connectedAccountModel,
    authMiddleware: authMiddleware || ((req, _res, next) => { req.user = { uid: "u1", email: "paul@example.com" }; next(); }),
  }));
  return { app, users };
};

const listen = (app) => {
  const server = app.listen(0);
  return { server, base: () => `http://127.0.0.1:${server.address().port}/api/auth` };
};

test("GET /me returns Nigeria as the default time zone when no country is set yet", async (t) => {
  const { app } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const response = await fetch(`${base()}/me`).then((r) => r.json());
  assert.equal(response.user.country, null);
  assert.equal(response.user.timeZone, "Africa/Lagos");
  assert.equal(response.user.legalAcceptance.accepted, false);
});

test("legal acceptance records both current versions and a timestamp, then /me reports accepted", async (t) => {
  const { app, users } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const accepted = await fetch(`${base()}/legal-acceptance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "client-controlled-version" }) });
  assert.equal(accepted.status, 200);
  const result = await accepted.json();
  assert.equal(result.legalAcceptance.termsVersion, result.legalAcceptance.currentVersion);
  assert.equal(result.legalAcceptance.privacyVersion, result.legalAcceptance.currentVersion);
  assert.equal(result.legalAcceptance.accepted, true);
  assert.ok(result.legalAcceptance.acceptedAt);
  assert.ok(users[0].legalAcceptance.acceptedAt instanceof Date);
  const me = await fetch(`${base()}/me`).then((response) => response.json());
  assert.equal(me.user.legalAcceptance.accepted, true);
});

test("an old legal version remains unaccepted", async (t) => {
  const { app } = makeApp({ users: [{ firebaseUid: "u1", legalAcceptance: { termsVersion: "2026-10-04", privacyVersion: "2026-10-04", acceptedAt: new Date() }, async save() {} }] });
  const { server, base } = listen(app);
  t.after(() => server.close());
  const me = await fetch(`${base()}/me`).then((response) => response.json());
  assert.equal(me.user.legalAcceptance.accepted, false);
});

test("unauthenticated callers cannot record legal acceptance", async (t) => {
  const { app } = makeApp({ authMiddleware: (_req, res) => res.status(401).json({ success: false }) });
  const { server, base } = listen(app);
  t.after(() => server.close());
  const response = await fetch(`${base()}/legal-acceptance`, { method: "POST" });
  assert.equal(response.status, 401);
});

test("PATCH /me/country sets the country and its resolved time zone, then /me reflects it", async (t) => {
  const { app } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const patch = await fetch(`${base()}/me/country`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "Kenya" }) });
  assert.equal(patch.status, 200);
  const patched = await patch.json();
  assert.equal(patched.user.country, "Kenya");
  assert.equal(patched.user.timeZone, "Africa/Nairobi");
  const me = await fetch(`${base()}/me`).then((r) => r.json());
  assert.equal(me.user.country, "Kenya");
  assert.equal(me.user.timeZone, "Africa/Nairobi");
});

test("PATCH /me/country rejects an empty or unrecognized country without saving anything", async (t) => {
  const { app, users } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const empty = await fetch(`${base()}/me/country`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "  " }) });
  assert.equal(empty.status, 400);
  const unknown = await fetch(`${base()}/me/country`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "Narnia" }) });
  assert.equal(unknown.status, 400);
  assert.equal(users.find((u) => u.firebaseUid === "u1"), undefined);
});

test("a multi-time-zone country still gets one usable default instead of a rejection", async (t) => {
  const { app } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const patch = await fetch(`${base()}/me/country`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "United States" }) });
  const patched = await patch.json();
  assert.equal(patch.status, 200);
  assert.equal(patched.user.country, "United States");
  assert.ok(patched.user.timeZone.startsWith("America/"));
});

test("PATCH /me/country stores the explicit time zone picked for a multi-zone country", async (t) => {
  const { app } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const patch = await fetch(`${base()}/me/country`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "United States", timeZone: "America/Chicago" }) });
  const patched = await patch.json();
  assert.equal(patch.status, 200);
  assert.equal(patched.user.timeZone, "America/Chicago");
});

test("PATCH /me/country ignores an invalid time zone and falls back to the country default", async (t) => {
  const { app } = makeApp();
  const { server, base } = listen(app);
  t.after(() => server.close());
  const patch = await fetch(`${base()}/me/country`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ country: "Kenya", timeZone: "Mars/Olympus" }) });
  assert.equal((await patch.json()).user.timeZone, "Africa/Nairobi");
});
