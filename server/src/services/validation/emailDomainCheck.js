const dns = require("node:dns");

// Well-known consumer providers. This is only used to catch a likely typo of
// ONE of these specific domains (e.g. "gmal.com" -> "gmail.com"). It is never
// treated as a whitelist — any other domain that has a working mail server is
// a perfectly legitimate address (companies run mail on their own domains).
const KNOWN_PROVIDERS = [
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
  "live.com", "aol.com", "protonmail.com", "proton.me", "msn.com", "yandex.com",
];

const domainOf = (email) => {
  const domain = String(email || "").split("@")[1];
  return typeof domain === "string" && domain.trim() ? domain.trim().toLowerCase() : null;
};

// Plain Levenshtein edit distance — catches missing/swapped/extra letters
// ("gmal.com", "gmial.com", "gmaill.com") without a hardcoded typo list.
const levenshtein = (a, b) => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
};

// Only suggest a correction when the domain is CLOSE to a known provider but
// not an exact match — a tight distance threshold, and a length floor, so we
// never "correct" a short, unrelated custom domain (e.g. "acme.co").
const suggestKnownProviderTypo = (domain) => {
  if (!domain || domain.length < 5 || KNOWN_PROVIDERS.includes(domain)) return null;
  let best = null;
  for (const provider of KNOWN_PROVIDERS) {
    const distance = levenshtein(domain, provider);
    if (distance > 0 && distance <= 2 && (!best || distance < best.distance)) best = { provider, distance };
  }
  return best?.provider || null;
};

// Resolves true (mailable) unless DNS positively confirms there's no such
// domain or no mail records for it (ENOTFOUND/ENODATA). Any other failure
// (timeout, server failure, no network reachability at all) fails OPEN —
// we never want a transient DNS hiccup to block a legitimate send.
const hasMailServer = (domain) => new Promise((resolve) => {
  dns.resolveMx(domain, (error, addresses) => {
    if (!error) return resolve(Array.isArray(addresses) && addresses.length > 0 && addresses.some((entry) => entry?.exchange));
    if (error.code === "ENOTFOUND" || error.code === "ENODATA") return resolve(false);
    resolve(true);
  });
});

// Sanity-checks an email address's domain before it's used to send, draft, or
// invite. Returns one of:
//   { status: "ok" }                                        — proceed as typed
//   { status: "likely_typo", domain, suggestion, correctedEmail }
//   { status: "no_mail_server", domain }
//   { status: "unknown" }                                    — not a parseable address; caller's own format check handles it
// This never rejects a domain merely for being unfamiliar. A company's own
// domain (e.g. "acme.com") is a legitimate place to receive mail and is only
// flagged if it genuinely has no mail server at all.
// `resolveMailServer` is injectable so tests never make a real DNS query.
const createEmailDomainCheck = ({ resolveMailServer = hasMailServer } = {}) => {
  const checkEmailDomain = async (email) => {
    const domain = domainOf(email);
    if (!domain) return { status: "unknown" };
    if (KNOWN_PROVIDERS.includes(domain)) return { status: "ok" };
    const suggestion = suggestKnownProviderTypo(domain);
    if (suggestion) return { status: "likely_typo", domain, suggestion, correctedEmail: email.slice(0, email.lastIndexOf("@") + 1) + suggestion };
    const mailable = await resolveMailServer(domain);
    return mailable ? { status: "ok" } : { status: "no_mail_server", domain };
  };
  return { checkEmailDomain };
};

const defaultChecker = createEmailDomainCheck();

module.exports = {
  createEmailDomainCheck,
  checkEmailDomain: defaultChecker.checkEmailDomain,
  suggestKnownProviderTypo, domainOf, KNOWN_PROVIDERS,
};
