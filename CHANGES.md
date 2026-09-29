# Changes in this update
1. Groq 429 fix: SDK retries (2), one fallback model (GROQ_FALLBACK_MODEL, default openai/gpt-oss-120b), and 429 now returns "NOMI is handling a lot right now" instead of a generic error.
2. Dark mode: sent-message bubble uses text-surface (was text-white on bg-ink, which flips to light in dark mode).
3. Country + time zone: A-Z country dropdown plus a state/region time-zone dropdown for multi-zone countries, in Sign-up, Onboarding and Settings. Backend accepts an explicit IANA timeZone.
4. Email display: server returns bodyHtml; client renders it sanitized (DOMPurify, styles kept) in a sandboxed iframe with images shown.
5. Opening an email now marks it read (one-time approval; explicit deny still respected).
Run: cd client && npm install ; cd ../server && npm install
6. Opened emails: plain-text fallback shortens tracking URLs, adds "Open in Gmail", and the HTML body is no longer saved into chat history.
