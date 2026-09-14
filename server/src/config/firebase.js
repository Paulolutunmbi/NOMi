const { applicationDefault, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error("GOOGLE_APPLICATION_CREDENTIALS is required");
}

const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: applicationDefault() });

module.exports = {
  app,
  auth: () => getAuth(app),
};
