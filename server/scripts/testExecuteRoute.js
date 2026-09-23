require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const connectDatabase = require('../src/config/database');
const { registerIntegration } = require('../src/services/integrations/integrationRegistry');
const googleIntegration = require('../src/services/integrations/googleIntegration');
const { createAIActionRouter } = require('../src/routes/aiActionRoutes');
const { createAIGateway } = require('../src/services/ai/aiGateway');
const { createGroqProvider } = require('../src/services/ai/groqProvider');

registerIntegration(googleIntegration);

async function testExecute() {
  await connectDatabase();

  const store = new Map();
  const contextService = {
    getActive: async ({ userId, conversationId }) => store.get(`${userId}:${conversationId}`) || null,
    create: async ({ userId, conversationId }) => {
      const conv = { userId, conversationId, messages: [] };
      store.set(`${userId}:${conversationId}`, conv);
      return conv;
    },
    update: async ({ userId, conversationId, ...changes }) => {
      const conv = store.get(`${userId}:${conversationId}`) || { userId, conversationId, messages: [] };
      Object.assign(conv, changes);
      store.set(`${userId}:${conversationId}`, conv);
      return conv;
    }
  };

  const app = express();
  app.use(express.json());
  
  const gateway = createAIGateway({ providerName: 'groq', adapters: { groq: createGroqProvider() } });
  const validOid = new mongoose.Types.ObjectId();

  app.use('/api/ai', createAIActionRouter({
    contextService,
    gateway,
    getUser: async (u) => ({ _id: validOid, email: 'test@example.com' }),
    authMiddleware: (req, res, next) => { req.user = { uid: validOid.toString() }; next(); }
  }));

  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const port = server.address().port;

  async function post(body) {
    const res = await fetch(`http://127.0.0.1:${port}/api/ai/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }

  // Step 1: Calendar search request
  console.log('\n--- Step 1: Calendar search request ---');
  let r1 = await post({ conversationId: 'conv-cal', message: "What's on my calendar tomorrow?" });
  console.log('Status 1:', r1.status);
  console.log('Body 1:', JSON.stringify(r1.data));

  // Step 2: Calendar search approval
  console.log('\n--- Step 2: Calendar search approval ---');
  let r2 = await post({ conversationId: 'conv-cal', message: "What's on my calendar tomorrow?", approval: "allow_once" });
  console.log('Status 2:', r2.status);
  console.log('Body 2:', JSON.stringify(r2.data));

  server.close();
  await mongoose.disconnect();
  process.exit(0);
}

testExecute().catch(e => { console.error(e); process.exit(1); });
