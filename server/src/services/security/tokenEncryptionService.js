const crypto = require("crypto");
const { getGoogleOAuthConfig } = require("../../config/googleOAuth");

const getKey = () => {
  const supplied = getGoogleOAuthConfig().tokenEncryptionKey.trim();
  const key = /^[a-fA-F0-9]{64}$/.test(supplied) ? Buffer.from(supplied, "hex") : Buffer.from(supplied, "base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must encode exactly 32 bytes");
  return key;
};

const encrypt = (plaintext) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
};

const decrypt = (payload) => {
  if (!payload?.iv || !payload?.tag || !payload?.ciphertext) throw new Error("Stored credential is invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
};

module.exports = { encrypt, decrypt };
