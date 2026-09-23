import { useEffect, useState } from 'react'
import { Navigate, Route, BrowserRouter, Routes } from 'react-router-dom'
import AppShell from './components/AppShell'
import LoadingScreen from './components/LoadingScreen'
import NomiLogo from './components/NomiLogo'
import Home from './pages/Home'
import Gmail from './pages/Gmail'
import CalendarPage from './pages/Calendar'
import Settings from './pages/Settings'
import { observeAuthState, signInWithGoogle, signOutUser } from './services/auth'

function SignInScreen() {
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSignIn = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      await signInWithGoogle()
    } catch (signInError) {
      setError(signInError.message || 'Sign-in failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex h-svh flex-col items-center justify-center gap-6 bg-surface-muted px-6 text-center">
      <NomiLogo size={40} />
      <div>
        <h1 className="text-xl font-semibold text-ink">Your intelligent workspace for email and calendar</h1>
        <p className="mt-2 max-w-sm text-sm text-ink-faint">Sign in to let NOMI help you manage Gmail and your calendar — always with your approval.</p>
      </div>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isSubmitting}
        className="rounded-xl bg-nomi-orange px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:opacity-60"
      >
        {isSubmitting ? 'Signing in…' : 'Continue with Google'}
      </button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function App() {
  const [user, setUser] = useState(undefined)

  useEffect(() => observeAuthState(setUser), [])

  if (user === undefined) return <LoadingScreen label="Checking your sign-in…" />
  if (!user) return <SignInScreen />

  return (
    <BrowserRouter>
      <AppShell userLabel={user.email} onSignOut={signOutUser}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/gmail" element={<Gmail />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  )
}

export default App
