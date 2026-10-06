import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hasOnboarded } from '../utils/onboarding'
import LoadingScreen from './LoadingScreen'

// Any authenticated NOMI route. Does not require a connected Google account —
// a user who has disconnected Google should still be able to reach Settings
// to reconnect, not get locked out of the app entirely.
export function RequireAuth({ children }) {
  const { authLoading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (authLoading) return <LoadingScreen label="Checking your sign-in…" />
  if (!isAuthenticated) return <Navigate to="/sign-in" replace state={{ from: location }} />
  return children
}

export function RequireLegalAcceptance({ children }) {
  const { legalAcceptance, legalStatusLoading } = useAuth()
  const location = useLocation()
  if (legalStatusLoading) return <LoadingScreen label="Checking legal acceptance…" />
  if (legalAcceptance?.accepted !== true) return <Navigate to="/legal-acceptance" replace state={{ from: location }} />
  return children
}

// Sign in / sign up / forgot password: only for signed-out visitors.
export function RequireGuest({ children }) {
  const { authLoading, isAuthenticated, user, googleConnected, googleStatusLoading, legalAcceptance, legalStatusLoading } = useAuth()

  if (authLoading) return <LoadingScreen label="Checking your sign-in…" />
  if (isAuthenticated) {
    if (legalStatusLoading) return <LoadingScreen label="Checking legal acceptance…" />
    if (legalAcceptance?.accepted !== true) return <Navigate to="/legal-acceptance" replace />
    if (googleStatusLoading) return <LoadingScreen label="Loading your workspace…" />
    const target = googleConnected || hasOnboarded(user?.uid) ? '/app' : '/onboarding'
    return <Navigate to={target} replace />
  }
  return children
}
