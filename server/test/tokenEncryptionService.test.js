const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.GOOGLE_CLIENT_ID = "test-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.GOOGLE_OAUTH_REDIRECT_URI = "http://localhost/callback";
process.env.GOOGLE_OAUTH_STATE_SECRET = "test-state-secret";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT_URI = "http://localhost";

const { encrypt, decrypt } = require("../src/services/security/tokenEncryptionService");

test("Google credentials are encrypted with authenticated encryption", () => {
  const encrypted = encrypt("credential-value");
  assert.notEqual(encrypted.ciphertext, "credential-value");
  assert.equal(decrypt(encrypted), "credential-value");
  assert.throws(() => decrypt({ ...encrypted, tag: Buffer.alloc(16).toString("base64") }));
});
