require('dotenv').config();
const { createAIGateway } = require('../src/services/ai/aiGateway');
const { createGroqProvider } = require('../src/services/ai/groqProvider');

const gw = createAIGateway({ providerName: 'groq', adapters: { groq: createGroqProvider() } });

async function run() {
  const msgs = [
    "Reply to Paul and tell him I'll get back to him tomorrow.",
    "Make it more casual.",
    "Send it.",
    "What's on my calendar tomorrow?",
    "Create a meeting tomorrow at 2pm.",
    "Find my unread emails from the last 7 days",
    "1",
    "the second one",
    "continue"
  ];
  for (const msg of msgs) {
    console.log('\n--- Testing:', msg);
    const r = await gw.generateIntent({
      safeInput: { userRequest: msg },
      placeholderMappings: {},
      trustedConversationContext: { gmailMessageIds: [], calendarEventIds: [] }
    });
    console.log('STATUS:', r.status, 'ACTION:', r.intent?.action, 'REASON:', r.reason);
    if (r.intent) {
      console.log('PARAMS:', JSON.stringify(r.intent.parameters));
    }
    // Sleep 1s to avoid rate limits
    await new Promise(res => setTimeout(res, 1000));
  }
}

run().catch(console.error);
