const SENSITIVE_PATTERNS = [
  { type: "URL_CREDENTIAL", category: "credential", confidence: "high", pattern: /https?:\/\/[^\s\/@:]+:[^\s\/@]+@[^\s/]+[^\s]*/gi },
  { type: "URL_SECRET", category: "credential", confidence: "high", pattern: /https?:\/\/[^\s]+[?&](?:access_token|api[_-]?key|token|secret|password)=[^\s&#]+/gi },
  { type: "EMAIL", category: "personal", confidence: "high", pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "JWT", category: "credential", confidence: "high", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { type: "API_KEY", category: "credential", confidence: "high", pattern: /\b(?:sk|pk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/gi },
  { type: "SECRET", category: "credential", confidence: "high", pattern: /\b(?:api[_-]?key|secret|password|access[_-]?token|refresh[_-]?token)\s*[:=]\s*['\"]?[^\s'\";,]{8,}/gi },
  { type: "IBAN", category: "financial", confidence: "high", pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g },
  { type: "PHONE", category: "personal", confidence: "medium", pattern: /(?<!\w)(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3}[\s.-]\d{3,4}(?!\w)/g },
  { type: "CARD", category: "financial", confidence: "high", pattern: /\b(?:\d[ -]?){13,19}\b/g },
  { type: "BANK_ACCOUNT", category: "financial", confidence: "medium", pattern: /\b(?:account|acct)\s*(?:number|no\.?)?\s*[:#-]?\s*\d{6,17}\b/gi },
];

const luhnValid = (value) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let index = digits.length - 1, parity = 0; index >= 0; index -= 1, parity = 1 - parity) {
    let digit = Number(digits[index]);
    if (parity) digit *= 2;
    sum += digit > 9 ? digit - 9 : digit;
  }
  return sum % 10 === 0;
};

const overlaps = (candidate, accepted) => accepted.some((item) => candidate.start < item.end && candidate.end > item.start);

const classifyText = (text) => {
  if (typeof text !== "string") throw new TypeError("Text to classify must be a string");
  const candidates = [];
  for (const rule of SENSITIVE_PATTERNS) {
    for (const match of text.matchAll(rule.pattern)) {
      const value = match[0];
      if (rule.type === "CARD" && !luhnValid(value)) continue;
      candidates.push({ type: rule.type, category: rule.category, confidence: rule.confidence, value, start: match.index, end: match.index + value.length });
    }
  }
  return candidates
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce((accepted, candidate) => (overlaps(candidate, accepted) ? accepted : [...accepted, candidate]), []);
};

module.exports = { classifyText, luhnValid };
