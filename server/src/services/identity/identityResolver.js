const normalize = (value) => String(value || "").trim().toLowerCase();

const resolveIdentity = ({ query, candidates, minimumConfidence = 0.7 }) => {
  const normalizedQuery = normalize(query);
  const matches = candidates
    .map((candidate) => {
      const email = normalize(candidate.email);
      const name = normalize(candidate.displayName);
      const exact = normalizedQuery === email || normalizedQuery === name;
      const partial = name.split(/\s+/).includes(normalizedQuery) || email.startsWith(`${normalizedQuery}@`);
      return { ...candidate, confidence: exact ? 1 : partial ? 0.7 : 0 };
    })
    .filter((candidate) => candidate.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (matches.length === 1 && matches[0].confidence >= minimumConfidence) {
    return { status: "resolved", identity: matches[0] };
  }

  if (matches.length > 0) {
    return { status: "ambiguous", candidates: matches };
  }

  return { status: "not_found", candidates: [] };
};

module.exports = { resolveIdentity };
