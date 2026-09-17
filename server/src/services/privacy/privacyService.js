const { classifyText } = require("./dataClassificationService");

const protectedMatches = (text, protectedValues = []) => protectedValues.flatMap((entry) => {
  const value = typeof entry === "string" ? entry : entry?.value;
  const type = typeof entry === "string" ? "PERSON" : entry?.type || "PERSON";
  if (!value) return [];
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...text.matchAll(new RegExp(`\\b${escaped}\\b`, "gi"))].map((match) => ({ type, category: "protected", confidence: "explicit", value: match[0], start: match.index, end: match.index + match[0].length }));
});

const redactForAI = (text, { protectedValues = [], state } = {}) => {
  const findings = [...classifyText(text), ...protectedMatches(text, protectedValues)]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .reduce((items, item) => items.some((other) => item.start < other.end && item.end > other.start) ? items : [...items, item], []);
  const mappingState = state || { counters: new Map(), byValue: new Map(), mappings: {} };
  let cursor = 0;
  let redactedText = "";
  for (const finding of findings) {
    redactedText += text.slice(cursor, finding.start);
    const key = `${finding.type}:${finding.value.toLowerCase()}`;
    let placeholder = mappingState.byValue.get(key);
    if (!placeholder) {
      const next = (mappingState.counters.get(finding.type) || 0) + 1;
      mappingState.counters.set(finding.type, next);
      placeholder = `[${finding.type}_${next}]`;
      mappingState.byValue.set(key, placeholder);
      mappingState.mappings[placeholder] = { value: finding.value, type: finding.type };
    }
    redactedText += placeholder;
    cursor = finding.end;
  }
  redactedText += text.slice(cursor);
  return { redactedText, findings: findings.map(({ value, ...safe }) => ({ ...safe, placeholder: mappingState.byValue.get(`${safe.type}:${value.toLowerCase()}`) })), mappings: mappingState.mappings };
};

const restorePlaceholders = (value, mappings = {}) => {
  if (typeof value === "string") return value.replace(/\[[A-Z_]+_\d+\]/g, (placeholder) => mappings[placeholder]?.value || placeholder);
  if (Array.isArray(value)) return value.map((item) => restorePlaceholders(item, mappings));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restorePlaceholders(item, mappings)]));
  return value;
};

const prepareAIInput = ({ userRequest, retrievedContent, untrustedRetrievedContent, protectedValues = [] }) => {
  const sources = retrievedContent || untrustedRetrievedContent || [];
  const state = { counters: new Map(), byValue: new Map(), mappings: {} };
  const request = redactForAI(userRequest, { protectedValues, state });
  const content = sources.map((item) => ({
    source: item.source || "external",
    content: redactForAI(item.content, { protectedValues, state }).redactedText,
  }));
  return { payload: { userRequest: request.redactedText, untrustedRetrievedContent: content }, mappings: state.mappings };
};

const externalAIPayload = (input) => prepareAIInput(input).payload;

module.exports = { redactForAI, restorePlaceholders, prepareAIInput, externalAIPayload };
