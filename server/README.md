# NOMI — server

Express API for NOMI: authentication, the AI intent pipeline, action
execution (Gmail/Calendar), pending-send approvals, attachments, and Google
OAuth.

See the [project root README](../README.md) for full setup (client, Google
OAuth Cloud Console steps, all environment variables) — this file covers
server-specific details.

## Setup

```bash
npm install
cp .env.example .env   # see root README for what each variable does
npm run dev             # http://localhost:5000
```

## Scripts

- `npm run dev` — start with auto-reload (nodemon)
- `npm start` — start without auto-reload
- `npm test` — run the test suite (`server/test/`)
- `npm run test:groq` — development-only Groq connectivity check with no
  Gmail data involved; refuses to run in production

## Structure

```
src/
├── routes/      Express routes (auth, chats, AI actions, Google integration, attachments)
├── services/
│   ├── ai/            Prompt construction, Groq provider, intent validation
│   ├── actions/       actionOrchestrator (dispatches an intent) and actionExecutor (runs/stages it)
│   ├── integrations/  Gmail and Calendar API providers
│   ├── attachments/   Upload/storage via Cloudinary
│   └── ...
└── models/      Mongoose schemas (User, PendingSendAction, chats, etc.)
```

## AI intent endpoint

Create a Groq API key in the Groq console and set `AI_PROVIDER=groq`,
`GROQ_API_KEY`, and optionally `GROQ_MODEL` in `server/.env`. The key
belongs only in `server/.env`, never in the client.

`POST /api/ai/intent` uses the existing Firebase authentication middleware
and accepts `{ "conversationId": "...", "message": "..." }`. It redacts
sensitive data before inference, generates a structured proposal, and
validates it. It does not send Gmail, create drafts, alter permissions, or
execute actions — that only happens once the client sends an explicit
approval to `/api/ai/execute`.

