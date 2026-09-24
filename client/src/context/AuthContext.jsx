import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { observeAuthState, signOutUser as firebaseSignOut } from '../services/auth'
import { fetchGoogleStatus, logoutNomi } from '../api/nomiClient'

const AuthContext = createContext(null)

/**
 * Two distinct identities live here, and every consumer should keep them separate:
 *  - `user` / `isAuthenticated` — the NOMI account (Firebase-backed sign-in).
 *  - `googleStatus` / `googleConnected` — the connected Google account NOMI
 *    was given permission to use for Gmail/Calendar. A signed-in NOMI user
 *    may have no Google account connected at all.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined) // undefined = still checking, null = signed out
  const [googleStatus, setGoogleStatus] = useState(undefined) // undefined = not loaded yet, null = failed to load
  const [googleStatusError, setGoogleStatusError] = useState(null)

  useEffect(() => observeAuthState(setUser), [])

  const refreshGoogleStatus = useCallback(async () => {
    setGoogleStatusError(null)
    try {
      const data = await fetchGoogleStatus()
      setGoogleStatus(data)
      return data
    } catch (error) {
      setGoogleStatus(null)
      setGoogleStatusError(error)
      return null
    }
  }, [])

  useEffect(() => {
    if (!user) return undefined
    let cancelled = false

    fetchGoogleStatus()
      .then((data) => {
        if (!cancelled) setGoogleStatus(data)
      })
      .catch((error) => {
        if (cancelled) return
        setGoogleStatus(null)
        setGoogleStatusError(error)
      })

    return () => {
      cancelled = true
    }
  }, [user])

  // Once signed out, any previously-fetched Google status no longer
  // applies — computed here rather than reset via a second effect, so
  // there's exactly one place that owns "what do we know right now".
  const effectiveGoogleStatus = user ? googleStatus : undefined
  const effectiveGoogleStatusError = user ? googleStatusError : null

  const signOut = useCallback(async () => {
    await logoutNomi().catch(() => {
      // Best-effort server-side session revocation; sign-out proceeds either way.
    })
    await firebaseSignOut()
  }, [])

  const value = {
    user: user || null,
    authLoading: user === undefined,
    isAuthenticated: Boolean(user),
    googleStatus: effectiveGoogleStatus,
    googleConnected: Boolean(effectiveGoogleStatus?.connected),
    googleStatusLoading: Boolean(user) && effectiveGoogleStatus === undefined,
    googleStatusError: effectiveGoogleStatusError,
    refreshGoogleStatus,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components -- hook belongs next to its provider
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
