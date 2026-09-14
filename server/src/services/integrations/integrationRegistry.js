const integrations = new Map();

const registerIntegration = (integration) => {
  if (!integration?.provider || typeof integration.execute !== "function") {
    throw new Error("An integration must provide a provider and execute function");
  }
  integrations.set(integration.provider, integration);
};

const getIntegration = (provider) => integrations.get(provider) || null;

module.exports = { registerIntegration, getIntegration };
