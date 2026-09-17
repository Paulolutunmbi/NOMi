const ACTIONS = {
  "gmail.read": { required: ["messageId"], allowed: ["messageId"] },
  "gmail.search": { required: ["query"], allowed: ["query", "maxResults"] },
  "gmail.draft": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
  "gmail.send": { required: ["recipient", "body"], allowed: ["recipient", "subject", "body"] },
};
const SAFE_STRING = (value, max = 10000) => typeof value === "string" && value.trim().length > 0 && value.length <= max;

const validateIntent = (intent) => {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return { valid: false, reason: "intent_must_be_an_object" };
  if (Object.keys(intent).some((key) => !["action", "parameters"].includes(key))) return { valid: false, reason: "unexpected_intent_field" };
  if (!ACTIONS[intent.action]) return { valid: false, reason: "unsupported_action" };
  if (!intent.parameters || typeof intent.parameters !== "object" || Array.isArray(intent.parameters)) return { valid: false, reason: "parameters_must_be_an_object" };
  const rule = ACTIONS[intent.action];
  const keys = Object.keys(intent.parameters);
  if (keys.some((key) => !rule.allowed.includes(key))) return { valid: false, reason: "unexpected_parameter" };
  if (rule.required.some((key) => !SAFE_STRING(intent.parameters[key]))) return { valid: false, reason: "missing_or_invalid_parameter" };
  if (intent.parameters.maxResults !== undefined && (!Number.isInteger(intent.parameters.maxResults) || intent.parameters.maxResults < 1 || intent.parameters.maxResults > 50)) return { valid: false, reason: "invalid_max_results" };
  return { valid: true, intent: { action: intent.action, parameters: { ...intent.parameters } } };
};

module.exports = { ACTIONS, validateIntent };
