# NOMI backend AI intent endpoint

Create a Groq API key in the Groq console and set `AI_PROVIDER=groq`, `GROQ_API_KEY`, and optionally `GROQ_MODEL` in `server/.env`. The key belongs only in `server/.env`, never in the client.

`POST /api/ai/intent` uses the existing Firebase authentication middleware and accepts `{ "conversationId": "...", "message": "..." }`. It redacts sensitive data before inference, generates a structured proposal, and validates it. It does not send Gmail, create drafts, alter permissions, or execute actions.

For a development-only connection check with no Gmail data, run `npm run test:groq` in `server`. It refuses to run in production.
