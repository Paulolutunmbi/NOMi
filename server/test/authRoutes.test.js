const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const path = require("node:path");

// authRoutes.js pulls in ../config/firebase at load time (for its default
// export), which throws without this env var — set here so this file can be
// run on its own, the same way the app's own start scripts already do via .env.
process.env.GOOGLE_APPLICATION_CREDENTIALS ||= path.join(__dirname, "..", "credentials", "firebase-service-account.json");

const { createAuthRouter } = require("../src/routes/authRoutes");

const makeApp = ({ users = [] } = {}) => {
  const findUser = (uid) => users.find((u) => u.firebaseUid === uid);
  const getUser = async (claims) => {
    let user = findUser(claims.uid);
    if (!user) {
      user = { firebaseUid: claims.uid, email: claims.email || null, displayName: claims.name || null, country: null, timeZone: null, async save() {} };
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
    authMiddleware: (req, _res, next) => { req.user = { uid: "u1", email: "paul@example.com" }; next(); },
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
