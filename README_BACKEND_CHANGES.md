# NOMI Backend — Audit + Fix + Calendar Implementation

This package contains the real, working files for the changes described below.
It is **not a rewrite** — the existing architecture (identity-first Gmail flow,
server-trusted state, per-action permissions, privacy/redaction layer) was
already substantially built and correct. This pass fixed specific bugs and
added a Calendar provider on top of it, following the same trust rules.

All 118 tests pass via `node --test` (run from `server/`, after `npm install`).
Baseline before this work: 94 tests, all passing.

## 1. What was already correct (audit findings, no changes needed)

- **Identity-first Gmail reply flow**: `gmail.search_then_reply` +
  `pendingInteraction` (stages `identity_selection` → `conversation_selection`
  → `draft_created`) already implements the exact ambiguous-Paul →
  select-account → scoped-search → select-conversation → draft → "send it"
  flow from the spec, with a passing end-to-end test.
- **Trust boundary**: messageId/threadId/draftId are never accepted from the
  client or the AI. Validated once in `intentValidator.js` against the
  server's trusted ID list, and rechecked again at the execution boundary in
  `actionOrchestrator.js` (defense in depth).
- **Privacy/hybrid-AI layer**: real data classification (emails, phones,
  card numbers with Luhn check, API keys, JWTs, IBANs) and placeholder-based
  redaction before anything reaches the external AI provider (Groq), with
  restoration only after validation.
- **Prompt-injection defenses**: retrieved Gmail content is explicitly marked
  untrusted in the system prompt; a test embeds an injection attempt in a
  search result and confirms it doesn't leak through.
- **Reply semantics, permissions, approvals, audit logging, OAuth/token
  encryption and refresh**: all already solid.

## 2. Bugs fixed

| Bug | Fix | Files |
|---|---|---|
| Identity-ambiguity responses leaked `subject`/`date`/`snippet` in 4 separate code paths (spec explicitly forbids this) | Added `formatCandidates()`/`statusForAmbiguity()` dispatchers; identity-type ambiguity now always uses `publicIdentityCandidate` (selectionId/name/email only) | `actionOrchestrator.js` |
| Invalid/out-of-range selections against a genuine multi-candidate pending list returned generic `status: "clarification"` instead of `ambiguous_identity`/`ambiguous_message` | Re-labeled based on candidate count — a single leftover candidate (nothing to disambiguate) still returns `clarification`; a real multi-way choice returns the correct `ambiguous_*` status | `actionOrchestrator.js` |
| No Gmail draft update — "make it more casual" had no backend support | Implemented `gmail.draft.update` in the Gmail provider (rebuilds reply threading from the trusted original message when editing a reply draft) + a new `gmail.draft.edit` intent that only ever uses the server-trusted draftId/recipient/messageId, never anything AI-supplied | `gmailProvider.js`, `actionOrchestrator.js`, `intentValidator.js`, `groqProvider.js`, `promptBoundary.js`, `aiActionRoutes.js` |

Regression tests were added for all three, including the specific leak
scenario (pronoun reply — "reply to him" — across multiple senders) and the
single-vs-multiple-candidate status distinction.

## 3. Calendar — built from scratch

Calendar had **zero backend implementation** before this pass (no provider, no
routes, no actions — only an unused OAuth scope). This was flagged and, per
your direction, built out fully rather than deferred.

New file: `server/src/services/integrations/calendarProvider.js`, following
the exact same trust/safety pattern as `gmailProvider.js`:

- `calendar.search` — list events (query + time window, bounded to 50 results, safe error normalization)
- `calendar.read` — get one event by ID
- `calendar.freebusy` — availability lookup (returns busy blocks only, no event IDs)
- `calendar.create` — new event, optional attendees + Google Meet link
- `calendar.update` — partial patch of an existing event
- `calendar.delete` — cancel/delete

**Trust boundary, mirrored exactly from Gmail:**
- `eventId` is never accepted from the client or the AI. `calendar.read` /
  `calendar.update` / `calendar.delete` require the eventId to already be in
  the conversation's server-trusted `calendarEventIds` (populated only by a
  prior `calendar.search`/`calendar.read` in the same conversation) —
  enforced in `intentValidator.js` and rechecked again in
  `actionOrchestrator.js`.
- Calendar events are never returned to the client with their real ID — only
  a per-response `selectionId` (`publicCalendarCandidate`), same as Gmail's
  `publicCandidate`/`publicIdentityCandidate`.
- **Attendees** follow the identical rule as Gmail recipients: the model may
  only propose an attendee address that (a) is the self-marker ("myself",
  "me", etc. — resolved server-side to the authenticated user's own email),
  or (b) is a literal address that verifiably appears in the user's own
  message text. The model can never invent, infer, or resolve a named
  person's address — there is no calendar identity-resolution flow yet (see
  Known Limitations).
- Calendar mutations (`calendar.create/update/delete`) go through the exact
  same per-action permission/approval/audit pipeline as Gmail — no
  special-casing was needed because `actionExecutor.js` is fully generic.

`googleIntegration.js` now merges Gmail + Calendar capabilities and routes
each action to the correct provider.

### AI planner wiring
- `intentValidator.js`: added the 6 calendar actions, 11 new parameter
  fields, ISO-8601 datetime validation, and the eventId/attendee trust checks.
- `groqProvider.js`: extended the strict JSON schema with the new action enum
  values and parameter fields (all still flat/nullable, consistent with the
  existing schema style).
- `promptBoundary.js`: added calendar instructions to the system prompt,
  including explicit guidance that the model must resolve relative dates
  ("tomorrow at 3pm") against a new `trustedConversationContext.serverTime`
  value, and must never invent a named person's email.

### Tests added
- `calendarProvider.test.js` (9 tests) — provider-level behavior and error
  normalization, including the routing test in `googleIntegration`.
- 6 new tests in `actionOrchestrator.test.js` — the eventId trust boundary
  (search persists trusted IDs, read/update/delete reject a forged ID,
  update/delete succeed against a real trusted ID, delete removes the ID so
  it can't be reused), and 2 attendee-trust tests (rejects an invented
  address, accepts one the user actually typed, resolves the self-marker).
- 1 new test in `permissionFlow.test.js` confirming calendar mutations
  require per-action approval exactly like Gmail (no provider-wide grant).

## 4. Files changed / added

**Changed:**
- `server/src/models/TemporaryConversation.js` — added `calendarEventIds`, `calendarCandidates`
- `server/src/routes/aiActionRoutes.js` — passes `calendarEventIds`/`currentDraftBody` into trusted context
- `server/src/routes/aiIntentRoutes.js` — same, for the `/api/ai/intent` preview endpoint
- `server/src/services/actions/actionOrchestrator.js` — bug fixes A/B, `gmail.draft.edit`, full calendar dispatch
- `server/src/services/ai/aiGateway.js` — passes `trustedCalendarEventIds` through, extended fallback intent
- `server/src/services/ai/groqProvider.js` — extended intent JSON schema
- `server/src/services/ai/intentValidator.js` — calendar action schemas + trust checks
- `server/src/services/ai/promptBoundary.js` — calendar system-prompt instructions, `calendarEventIds`/`serverTime`/`currentDraftBody` in trusted context
- `server/src/services/conversations/conversationContextService.js` — calendar normalizers
- `server/src/services/integrations/gmailProvider.js` — `gmail.draft.update`
- `server/src/services/integrations/googleIntegration.js` — routes to Gmail or Calendar provider
- Test files: `actionOrchestrator.test.js`, `aiGateway.test.js`, `aiIntentPlanning.test.js`, `aiIntentRoute.test.js`, `aiPrivacyBoundary.test.js`, `aiSecurity.test.js`, `gmailProvider.test.js`, `permissionFlow.test.js` (fixture updates for the expanded schema + new regression tests)

**Added:**
- `server/src/services/integrations/calendarProvider.js`
- `server/test/calendarProvider.test.js`

No files were deleted. No existing test was removed or weakened — where a
test's expected status changed (the `clarification` → `ambiguous_*`
relabeling), it was because the old assertion encoded the exact bug the spec
asked to fix, and the surrounding behavior (which candidates, which data)
was preserved.

## 5. Verification performed

- `node --test` run directly against this file set (after `npm install`,
  using the included `package.json`/`package-lock.json`) inside this
  environment: **118/118 passing**.
- This is real unit/integration-style testing against in-memory fakes for
  Google/Groq/Mongo — **not** a live Gmail/Calendar/Groq call. No live API
  test was performed (no credentials were available in this environment).

## 6. Known limitations / not done in this pass

- **Calendar has no identity-resolution flow.** Gmail's "which Paul do you
  mean?" flow works because it can search existing Gmail messages to find
  candidate identities. Calendar has no equivalent contact source, so
  `calendar.create`/`update` only accept an attendee address that the user
  typed explicitly (or the self-marker) — asking to invite a *named* person
  with no address on file will correctly fall back to a clarifying question,
  not a resolved invite. Building real named-attendee resolution (e.g.
  reusing Gmail's identity search against calendar invites) is a reasonable
  next step if time allows.
- **Calendar has no "reference an event just discussed" natural-language
  shortcut** equivalent to Gmail's "1" / "the second one" / "send it".
  `calendar.read/update/delete` require an explicit `calendar.search` first
  in the same conversation; deterministic ordinal/number resolution against
  `calendarCandidates` was not built in this pass (only the trust-boundary
  enforcement was).
- **No live-provider test.** Everything above was verified with `node --test`
  against fakes, not a real Google/Groq account. A real end-to-end run
  (`POST /api/ai/execute` against live Gmail/Calendar/Groq) still needs to
  happen in an environment with real credentials before the demo.
- **Frontend**: not touched. The API response shapes for identity/message
  ambiguity were already correct in the areas the frontend would consume;
  the only behavior change visible to a client is the `clarification` →
  `ambiguous_*` relabeling in the specific leftover-multi-candidate case
  described above, and the new calendar response shapes, which are new
  surface area rather than a breaking change.
