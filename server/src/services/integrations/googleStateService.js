const crypto = require("crypto");
const OAuthState = require("../../models/OAuthState");
const { getGoogleOAuthConfig } = require("../../config/googleOAuth");

const STATE_TTL_MS = 10 * 60 * 1000;
const base64url = (value) => Buffer.from(value).toString("base64url");
const sign = (encoded) => crypto.createHmac("sha256", getGoogleOAuthConfig().stateSecret).update(encoded).digest("base64url");
const hash = (state) => crypto.createHash("sha256").update(state).digest("hex");

const createOAuthState = async (user) => {
  const expiresAt = new Date(Date.now() + STATE_TTL_MS);
  const payload = { uid: String(user._id), jti: crypto.randomBytes(32).toString("base64url"), exp: expiresAt.getTime() };
  const encoded = base64url(JSON.stringify(payload));
  const state = `${encoded}.${sign(encoded)}`;
  await OAuthState.create({ stateHash: hash(state), user: user._id, expiresAt });
  return state;
};

const consumeOAuthState = async (state) => {
  if (typeof state !== "string") throw new Error("Invalid OAuth state");
  const [encoded, signature, ...extra] = state.split(".");
  const expected = sign(encoded);
  if (!encoded || !signature || extra.length || Buffer.byteLength(signature) !== Buffer.byteLength(expected) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid OAuth state");
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("Invalid OAuth state"); }
  if (!payload.uid || !payload.jti || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) throw new Error("Expired OAuth state");
  const record = await OAuthState.findOneAndDelete({ stateHash: hash(state), user: payload.uid, expiresAt: { $gt: new Date() } });
  if (!record) throw new Error("Invalid or previously used OAuth state");
  return record.user;
};

module.exports = { createOAuthState, consumeOAuthState };
