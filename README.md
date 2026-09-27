# NOMI

NOMI is an AI assistant that manages your Gmail and Google Calendar through
plain-language chat. You describe what you want ("find unread mail from my
manager", "reply to Paul and say thanks", "put a call on my calendar
tomorrow at 3"), NOMI turns that into a concrete action, and — for anything
that sends, edits, or deletes something on your behalf — asks you to approve
it first.

## How it's built

| Layer | Stack |
|---|---|
| Client | React 19 + Vite, React Router, Tailwind CSS, Firebase Auth (sign-in only) |
| Server | Node.js + Express 5, MongoDB (Mongoose), Firebase Admin (token verification) |
| AI | Groq (configurable via `AI_PROVIDER`) — turns a chat message into a structured, validated action proposal; never executes anything itself |
| Integrations | Gmail API and Google Calendar API via a backend-owned OAuth connection, Cloudinary for attachment storage |

```
NOMi/
├── client/     React app (chat UI, approval cards, settings) — see client/README.md
├── server/     Express API, AI intent pipeline, Gmail/Calendar integrations — see server/README.md
├── test/       Root-level integration tests (see also server/test/)
├── GOOGLE_OAUTH_SETUP.md   Step-by-step Google Cloud OAuth setup
└── README_BACKEND_CHANGES.md   Backend design notes / changelog
```

### The approval model

NOMI never sends an email, deletes anything, or otherwise acts on your
account without a distinct approval step. Read-only actions (searching or
reading mail, checking calendar availability) run immediately; anything else
comes back as a proposal you explicitly allow, edit, or deny.

## Getting started

You'll need Node.js 20+ (developed against Node 22), a MongoDB instance, a
Firebase project (for sign-in), a Google Cloud OAuth client (for Gmail and
Calendar access), and a Groq API key (for the AI intent pipeline).

### 1. Server

```bash
cd server
npm install
cp .env.example .env   # then fill in the values below
npm run dev             # starts on http://localhost:5000
```

Required `server/.env` values:

| Variable | Purpose |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `PORT` | API port (defaults to `5000`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client — see [`GOOGLE_OAUTH_SETUP.md`](./GOOGLE_OAUTH_SETUP.md) |
| `GOOGLE_OAUTH_REDIRECT_URI` | Must match the redirect URI registered in Google Cloud Console |
| `GOOGLE_OAUTH_STATE_SECRET` | High-entropy random string, used to sign the OAuth state parameter |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | 32 random bytes, base64 or 64-char hex — encrypts stored Google tokens at rest. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `GOOGLE_OAUTH_SUCCESS_REDIRECT_URI` | Where to send the browser back to after connecting Google (the client's URL) |
| `AI_PROVIDER` | `groq` |
| `GROQ_API_KEY` / `GROQ_MODEL` | Groq credentials for the intent pipeline. **Server-only — never put this in the client.** |
| `CLOUDINARY_URL` | Cloudinary connection string, used for chat/email attachment storage |

You'll also need Firebase Admin credentials available to the server (see
`server/credentials/` and `server/src` for how they're loaded) so incoming
requests can be authenticated.

Useful scripts (run from `server/`):

- `npm run dev` — start the API with auto-reload
- `npm start` — start the API without auto-reload
- `npm test` — run the backend test suite
- `npm run test:groq` — a development-only, no-Gmail-data connectivity check against Groq (refuses to run in production)

### 2. Client

```bash
cd client
npm install
cp .env.example .env   # then fill in the values below
npm run dev             # starts on http://localhost:5173
```

Required `client/.env` values:

| Variable | Purpose |
|---|---|
| `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` | Firebase web app config, for sign-in only |
| `VITE_API_BASE_URL` | Base URL of the running server (defaults to `http://localhost:5000`) |

No Google or Groq secret ever belongs in a client env file — the client only
holds Firebase config for authentication; the server owns every Google and
AI credential.

Other client scripts: `npm run build` (production build), `npm run preview`
(preview a production build locally), `npm run lint`.

### 3. Google OAuth

Gmail and Calendar access is a separate, backend-owned OAuth connection from
Firebase sign-in — a signed-in NOMI user still has to explicitly connect a
Google account from Settings before Gmail/Calendar actions work. Full setup
steps (Cloud Console project, consent screen, redirect URI, scopes) are in
[`GOOGLE_OAUTH_SETUP.md`](./GOOGLE_OAUTH_SETUP.md).

## Testing

```bash
cd server && npm test
```

Covers the AI intent pipeline, action orchestration (search/read/draft/send/
reply, identity and conversation disambiguation, calendar actions), pending
send approvals, attachment handling, and Gmail/Calendar provider behavior.

## Progressive Web App

NOMI can be installed as an app (manifest + service worker live in
`client/public/`). On Chrome/Android, an install banner appears
automatically; iOS Safari gets manual "Add to Home Screen" instructions,
since it doesn't support the native install prompt.

## Further reading

- [`server/README.md`](./server/README.md) — AI intent endpoint details
- [`client/README.md`](./client/README.md) — client-specific notes
- [`GOOGLE_OAUTH_SETUP.md`](./GOOGLE_OAUTH_SETUP.md) — Google Cloud OAuth setup, step by step
- [`README_BACKEND_CHANGES.md`](./README_BACKEND_CHANGES.md) — backend design notes and change history
