# NOMI — client

The React chat UI for NOMI: the conversation view, approval cards for
send/draft/calendar actions, identity/conversation disambiguation, settings,
and the PWA install experience.

See the [project root README](../README.md) for the full setup (server,
Google OAuth, environment variables) — this file covers the client only.

## Stack

React 19, Vite, React Router, Tailwind CSS, Firebase (sign-in only — Gmail
and Calendar access is a separate backend-owned OAuth connection, not
Firebase).

## Setup

```bash
npm install
cp .env.example .env   # fill in VITE_FIREBASE_* and VITE_API_BASE_URL
npm run dev
```

Runs at `http://localhost:5173` by default and expects the server (see
`../server/`) running at `VITE_API_BASE_URL` (defaults to
`http://localhost:5000`).

## Scripts

- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally
- `npm run lint` — run ESLint

## Structure

```
src/
├── components/   Chat UI, approval/candidate cards, AppShell (single sidebar), InstallBanner
├── context/      Auth, theme, and the shared chat-sidebar state
├── hooks/        useNomiConversation — drives the chat/action loop against the server
├── pages/        Workspace (chat), Settings
└── api/          Server API client
public/
├── manifest.webmanifest, sw.js, icon-*.png   PWA manifest, service worker, icons
```

## Progressive Web App

`public/manifest.webmanifest` and `public/sw.js` make the app installable.
The service worker only caches the static app shell — it explicitly never
intercepts `/api/` requests, so signed-in data is never served stale or
from cache. `InstallBanner.jsx` shows Chrome/Android's native install
prompt, or manual "Add to Home Screen" steps on iOS (which has no
programmatic install prompt). Registration is skipped in dev (`npm run dev`)
so it doesn't shadow Vite's HMR, and only runs against a production build.
