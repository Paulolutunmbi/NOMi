// Tracks, per NOMI account, whether the user has ever completed the
// first-time "connect Google" onboarding step. This is a local UX hint only
// (it decides whether to show onboarding vs. drop the user into the app with
// a reconnect banner) — it is never used as a substitute for the real
// Google-connection status, which always comes from the backend.
const KEY_PREFIX = 'nomi.onboarded.'

export function hasOnboarded(uid) {
  if (!uid) return false
  try {
    return window.localStorage.getItem(`${KEY_PREFIX}${uid}`) === 'true'
  } catch {
    return false
  }
}

export function markOnboarded(uid) {
  if (!uid) return
  try {
    window.localStorage.setItem(`${KEY_PREFIX}${uid}`, 'true')
  } catch {
    // Non-fatal: worst case, the user sees onboarding again next time.
  }
}
