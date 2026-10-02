# NOMI — fixes applied

Re-run `npm install` in both `server/` and `client/` (node_modules were stripped before zipping).

## Backend fixes

1. **Reply crash (`PendingSendAction ... conversationId is required`)**
   `server/src/services/actions/actionOrchestrator.js` — several calls to
   `actionExecutor(...)` in the identity-selection / conversation-selection /
   ambiguity-resolution flows were missing `conversationId`. Since a reply or
   send stages a `PendingSendAction` that requires it, this crashed exactly
   the flow you hit: pick a person → pick a conversation → reply. Also fixed
   two of those call sites to actually return `pendingAction` on
   `approval_required` instead of dropping it.

2. **Attachments empty/unopenable and never received**
   `server/src/services/actions/actionExecutor.js` and
   `server/src/services/integrations/gmailProvider.js` — attachment bytes
   staged in Mongo while a send awaits approval came back from the driver as
   a wrapped `Binary` object, not a plain `Buffer`. The old fallback silently
   produced a 0-byte file. Fixed by base64-encoding attachment data before
   staging it, and made the MIME builder handle any shape defensively.

3. **Attachment missing from the approval preview**
   `server/src/services/actions/actionExecutor.js` now includes
   `attachmentsMeta` on the pending action; the client renders it in the
   review card (`client/src/components/WorkspaceCards.jsx`).

4. **Calendar creation stuck on "NOMI couldn't do that safely"**
   `server/src/services/ai/intentValidator.js` and `actionOrchestrator.js` —
   `endDateTime` was hard-required with no way to infer a duration, so any
   event without an explicit end time failed forever regardless of what time
   you typed next. `endDateTime` is now optional and defaults to +1 hour
   after `startDateTime`; the model prompt (`promptBoundary.js`) now also
   explicitly says how to read casual times ("by 10pm", "0pm", etc).

5. **Better crash logs** — `server/src/server.js`'s error handler now logs
   the full stack trace and the route, not just `error.message`. If the
   "unread message click → Something went wrong" error happens again, the
   terminal will show exactly where.

## Frontend fixes

6. **Two competing sidebars → one sidebar**
   New `client/src/context/ChatSidebarContext.jsx` is the single source of
   truth for the chat list. `AppShell.jsx` now renders one sidebar (New
   Chat, Chat history, Settings) — persistent on desktop, a single drawer on
   mobile. `Workspace.jsx` no longer renders its own header/drawer.

7. **PWA support with an install banner**
   - `client/public/manifest.webmanifest` + generated icons
     (`icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `icon-32.png`,
     `icon-180.png`)
   - `client/public/sw.js` — app-shell caching only; never touches `/api/`
     so no auth/chat data is ever cached
   - `client/src/components/InstallBanner.jsx` — shows a native install
     prompt on Chrome/Android, manual "Add to Home Screen" steps on iOS
   - `client/index.html` / `client/src/main.jsx` wire the manifest and
     service worker in

## Verified

- `cd server && npm test` → 212/212 passing (includes the pending-send
  approval and calendar validation suites that cover the areas touched
  above).
- `cd client && npm run build` → builds clean.

## Not fixed — needs more info

**"Something went wrong" when clicking an unread message to open it.** I
couldn't reproduce this from the logs you pasted — there's no matching
crash in either terminal excerpt. I improved the error logging (#5 above) so
next time it happens, copy the new `Unhandled API error on ...` line
(it now includes the route and full stack trace) and send it over — that'll
pin it down fast.

## Follow-up send fix ("send this too" -> "NOMI couldn't do that safely")

`server/src/services/ai/aiGateway.js` — on a follow-up with no typed address
(e.g. "just another screenshot"), the planner correctly reused the recipient
from earlier in the chat, but the validator only trusted addresses typed in the
*current* message, so it failed with `untrusted_recipient_email`. The gateway now
also accepts the server-stored `trustedGmailPerson` address (only when no address
was typed this turn). Any other address is still rejected
(`explicit_recipient_mismatch`), and with no trusted recipient the old behaviour
is unchanged. Tests added in `server/test/aiGateway.test.js`.
