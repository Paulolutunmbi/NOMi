# Google OAuth setup

Phase 3A uses backend-owned Google OAuth. Firebase Authentication signs a NOMI user in; it is separate from the Google account that user may connect.

1. In [Google Cloud Console](https://console.cloud.google.com/), create or select a project.
2. Configure the OAuth consent screen and add test users while the app is in testing mode.
3. Enable the APIs required for this phase: Gmail API, Google Calendar API, and the Google OAuth user-info service.
4. Create an OAuth 2.0 Client ID for a **Web application**.
5. Add `http://localhost:5000/api/integrations/google/callback` as an authorized redirect URI (or the exact value of `GOOGLE_OAUTH_REDIRECT_URI`).
6. Populate the following backend-only values in `server/.env`:

   ```dotenv
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   GOOGLE_OAUTH_REDIRECT_URI=http://localhost:5000/api/integrations/google/callback
   GOOGLE_OAUTH_STATE_SECRET=
   GOOGLE_TOKEN_ENCRYPTION_KEY=
   GOOGLE_OAUTH_SUCCESS_REDIRECT_URI=http://localhost:5173
   ```

`GOOGLE_OAUTH_STATE_SECRET` should be a high-entropy random secret. `GOOGLE_TOKEN_ENCRYPTION_KEY` must be either 32 random bytes encoded as base64 or 64 hexadecimal characters; for example generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

The requested Gmail scopes are sensitive/restricted. A public production app may need Google's OAuth verification and security assessment process. Do not attempt to bypass that process.

The client may optionally set `VITE_API_BASE_URL` (defaults to `http://localhost:5000`). No Google secret belongs in any client environment file.
