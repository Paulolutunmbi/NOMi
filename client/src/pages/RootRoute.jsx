import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hasOnboarded, markOnboarded } from '../utils/onboarding'
import LoadingScreen from '../components/LoadingScreen'
import Landing from './Landing'

// The backend's Google OAuth callback redirects to the app's origin (root
// path) with ?google=connected|failed. Whichever page ends up handling that
// (almost always this one, since users only reach the callback while signed
// in) forwards the flag along to wherever it sends the user next, so that
// page can show the right banner instead of the flag getting silently lost.
export default function RootRoute() {
  const {
    authLoading,
    isAuthenticated,
    user,
    googleConnected,
    googleStatusLoading,
    legalAcceptance,
    legalStatusLoading,
  } = useAuth()
  const [searchParams] = useSearchParams()
  const googleParam = searchParams.get('google')

  if (authLoading) return <LoadingScreen label="Checking your sign-in…" />

  if (!isAuthenticated) return <Landing />

  // Legal acceptance must be settled BEFORE the Google status check, because
  // the Google status is only fetched once the user has accepted the current
  // legal version. Without this, users who haven't accepted wait forever.
  if (legalStatusLoading) return <LoadingScreen label="Checking legal acceptance…" />
  if (legalAcceptance?.accepted !== true) return <Navigate to="/legal-acceptance" replace />

  if (googleStatusLoading) return <LoadingScreen label="Loading your workspace…" />

  const search = googleParam ? `?google=${encodeURIComponent(googleParam)}` : ''

  if (googleConnected) {
    markOnboarded(user?.uid)
    return <Navigate to={`/app${search}`} replace />
  }

  if (hasOnboarded(user?.uid)) return <Navigate to={`/app${search}`} replace />

  return <Navigate to={`/onboarding${search}`} replace />
}