const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

const getAIConfig = (env = process.env) => ({
  provider: env.AI_PROVIDER || null,
  groqApiKey: env.GROQ_API_KEY || null,
  groqModel: env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
});

const validateAIConfig = (config = getAIConfig()) => {
  if (config.provider === "groq" && !config.groqApiKey) {
    const error = new Error("Groq is configured without an API key");
    error.code = "ai_provider_not_configured";
    throw error;
  }
  return config;
};

module.exports = { DEFAULT_GROQ_MODEL, getAIConfig, validateAIConfig };
