/* Development-only connection check. It never sends user, Gmail, or provider data. */
if (process.env.NODE_ENV === "production") {
  console.error("This development-only Groq check cannot run in production.");
  process.exitCode = 1;
} else {
  require("dotenv").config();
  const { createGroqProvider } = require("../src/services/ai/groqProvider");
  const { buildIntentPrompt } = require("../src/services/ai/promptBoundary");
  (async () => {
    try {
      const provider = createGroqProvider();
      const intent = await provider.generateIntent(buildIntentPrompt({ userRequest: "Search Gmail for invoices.", untrustedRetrievedContent: [] }));
      if (!intent || typeof intent !== "object") throw new Error("No structured intent returned");
      console.log("Groq structured intent connection verified.");
    } catch {
      console.error("Groq connection check failed safely.");
      process.exitCode = 1;
    }
  })();
}
