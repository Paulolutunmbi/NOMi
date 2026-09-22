/* Development-only connection check. It never sends user, Gmail, or provider data. */
if (process.env.NODE_ENV === "production") {
  console.error("This development-only Groq check cannot run in production.");
  process.exitCode = 1;
} else {
  require("dotenv").config();
  const { createGroqProvider } = require("../src/services/ai/groqProvider");
  const { getAIConfig } = require("../src/config/ai");
  const { buildIntentPrompt } = require("../src/services/ai/promptBoundary");
  const { isSelfRecipientMarker } = require("../src/services/ai/intentValidator");

  const sensitiveDetailPattern = /(?:authorization|api[-_ ]?key|oauth|token|secret|bearer|gsk_[a-z0-9_-]+|(?:request|prompt|input|messages?|content)\s*[:=])/i;
  const safeMessage = (value) => {
    if (typeof value !== "string" || !value.trim()) return "No safe provider message available.";
    if (sensitiveDetailPattern.test(value)) return "Sensitive error details redacted.";
    return value.slice(0, 500);
  };

  const providerResponseError = (source) => {
    if (source?.error && typeof source.error === "object"
      && (typeof source.error.message === "string" || typeof source.error.type === "string" || typeof source.error.code === "string")) {
      return source.error;
    }
    if (typeof source?.message !== "string") return null;
    try {
      const parsed = JSON.parse(source.message.replace(/^\d{3}\s+/, ""));
      return parsed?.error && typeof parsed.error === "object" ? parsed.error : null;
    } catch {
      const messageMatch = source.message.match(/"message"\s*:\s*("(?:\\.|[^"\\])*")/);
      const typeMatch = source.message.match(/"type"\s*:\s*"([^"\\]+)"/);
      let message;
      try { message = messageMatch ? JSON.parse(messageMatch[1]) : undefined; } catch { message = undefined; }
      const type = typeMatch?.[1];
      return message || type ? { message, type } : null;
    }
  };

  const safeDiagnostic = (error) => {
    const cause = error && typeof error === "object" ? error.cause : null;
    const source = cause && typeof cause === "object" ? cause : error;
    const responseError = providerResponseError(source);
    const status = source?.status ?? error?.status;
    const providerCode = responseError?.code ?? responseError?.type ?? source?.code;
    const { provider, groqModel } = getAIConfig();

    return {
      name: typeof source?.name === "string" ? source.name : "Error",
      ...(Number.isInteger(status) ? { status } : {}),
      ...(typeof providerCode === "string" ? { code: providerCode } : {}),
      ...(typeof error?.code === "string" ? { category: error.code } : {}),
      message: safeMessage(responseError?.message),
      provider,
      model: groqModel,
    };
  };

  (async () => {
    try {
      const provider = createGroqProvider();
      const intent = await provider.generateIntent(buildIntentPrompt({ userRequest: "Search Gmail for invoices.", untrustedRetrievedContent: [] }));
      if (!intent || typeof intent !== "object") throw new Error("No structured intent returned");
      const selfIntent = await provider.generateIntent(buildIntentPrompt({ userRequest: "Draft an email to my own email address saying this is a NOMI test.", untrustedRetrievedContent: [] }));
      if (selfIntent?.action !== "gmail.draft" || !isSelfRecipientMarker(selfIntent?.parameters?.recipient)) throw new Error("Self-recipient response did not match the expected structured shape");
      console.log("Groq structured intent connection and self-recipient response shape verified.");
    } catch (error) {
      console.error("Groq connection check failed safely.");
      console.error(JSON.stringify(safeDiagnostic(error), null, 2));
      process.exitCode = 1;
    }
  })();
}
