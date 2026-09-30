// One place that understands "a, b; c" recipient lists, so the validator,
// orchestrator, executor and Gmail provider can never disagree about what a
// valid list is. A single address is just a list of one, so every existing
// single-recipient path behaves exactly as before.
const MAX_RECIPIENTS = 10;
const EMAIL = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

// Split on commas/semicolons only. Addresses cannot contain whitespace, so
// nothing that could inject a header line survives the per-token EMAIL check.
const splitRecipientTokens = (value) => (typeof value === "string"
  ? [...new Set(value.split(/[,;]/).map((token) => token.trim()).filter(Boolean))]
  : []);

// Strict parse for anything that will be sent: every token must be a real
// address. Returns { ok, recipients } with lowercased, de-duplicated emails.
const parseRecipientList = (value, { max = MAX_RECIPIENTS } = {}) => {
  const tokens = splitRecipientTokens(value).map((token) => token.toLowerCase());
  const recipients = [...new Set(tokens)];
  if (!recipients.length || recipients.length > max) return { ok: false, recipients: [] };
  if (recipients.some((address) => !EMAIL.test(address))) return { ok: false, recipients: [] };
  return { ok: true, recipients };
};

module.exports = { MAX_RECIPIENTS, splitRecipientTokens, parseRecipientList };
