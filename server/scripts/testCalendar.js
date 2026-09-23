require('dotenv').config();
const { createAIGateway } = require('../src/services/ai/aiGateway');
const { createGroqProvider } = require('../src/services/ai/groqProvider');

const gw = createAIGateway({ providerName: 'groq', adapters: { groq: createGroqProvider() } });

async function run() {
  console.log("Calling Groq for create meeting...");
  const r = await gw.generateIntent({
    safeInput: { userRequest: "Create a meeting tomorrow at 2pm." },
    placeholderMappings: {},
    trustedConversationContext: { gmailMessageIds: [], calendarEventIds: [] }
  });
  console.log("RESULT:", JSON.stringify(r));
}

run().catch(console.error);
