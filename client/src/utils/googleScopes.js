// Reads the actual scopes NOMI's backend recorded for a connected Google
// account, rather than assuming access — an account connected before a
// scope was added, or with a partial grant, should show accurately.
export function summarizeGoogleScopes(scopes = []) {
  const list = Array.isArray(scopes) ? scopes : []
  const has = (fragment) => list.some((scope) => scope.includes(fragment))

  return {
    gmail: has('gmail'),
    calendar: has('calendar'),
  }
}
