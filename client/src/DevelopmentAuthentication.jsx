import { useEffect, useState } from 'react'
import {
  observeAuthState,
  registerWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithGoogle,
  signOutUser,
} from './services/auth'

function DevelopmentAuthentication({ children }) {
  const [user, setUser] = useState(undefined)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => observeAuthState(setUser), [])

  const runAuthentication = async (authenticationAction) => {
    setError('')
    setIsSubmitting(true)

    try {
      await authenticationAction()
    } catch (authenticationError) {
      setError(authenticationError.message || 'Authentication failed. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEmailSignIn = (event) => {
    event.preventDefault()
    const isCreatingAccount = event.nativeEvent.submitter?.value === 'create-account'
    runAuthentication(() => (
      isCreatingAccount
        ? registerWithEmailAndPassword(email, password)
        : signInWithEmailAndPassword(email, password)
    ))
  }

  if (user === undefined) {
    return <main><p>Checking authentication…</p></main>
  }

  if (!user) {
    return (
      <main>
        <section aria-labelledby="development-authentication-heading">
          <h1 id="development-authentication-heading">Development authentication</h1>
          <p>Temporary sign-in screen for local development. This is not the final NOMI authentication experience.</p>

          <button type="button" onClick={() => runAuthentication(signInWithGoogle)} disabled={isSubmitting}>
            Continue with Google
          </button>

          <form onSubmit={handleEmailSignIn}>
            <p>
              <label htmlFor="development-auth-email">Email</label>
              <input
                id="development-auth-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </p>
            <p>
              <label htmlFor="development-auth-password">Password</label>
              <input
                id="development-auth-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </p>
            <button type="submit" disabled={isSubmitting}>Sign in with email</button>
            <button type="submit" value="create-account" disabled={isSubmitting}>Create account</button>
          </form>

          {error && <p role="alert">{error}</p>}
        </section>
      </main>
    )
  }

  return (
    <>
      <section aria-label="Development authentication status">
        <p>
          Development authentication: signed in as {user.displayName || 'NOMI user'}
          {user.email && ` (${user.email})`}.
        </p>
        <button type="button" onClick={() => runAuthentication(signOutUser)} disabled={isSubmitting}>Sign out</button>
        {error && <p role="alert">{error}</p>}
      </section>
      {children}
    </>
  )
}

export default DevelopmentAuthentication
