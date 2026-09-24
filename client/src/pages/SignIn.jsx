import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthCard, { AuthDivider, AuthError, AuthField, GoogleButton } from '../components/AuthCard'
import { friendlyAuthError, signInWithEmailAndPassword, signInWithGoogle } from '../services/auth'

export default function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const redirectAfterSignIn = () => {
    const from = location.state?.from
    navigate(from ? `${from.pathname}${from.search || ''}` : '/', { replace: true })
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await signInWithEmailAndPassword(email.trim(), password)
      redirectAfterSignIn()
    } catch (submitError) {
      setError(friendlyAuthError(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogle = async () => {
    setError('')
    setIsSubmitting(true)
    try {
      await signInWithGoogle()
      redirectAfterSignIn()
    } catch (submitError) {
      setError(friendlyAuthError(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthCard
      title="Sign in to NOMI"
      subtitle="This signs you in to your NOMI account, not your Gmail — that's connected separately."
      footer={
        <>
          New to NOMI?{' '}
          <Link to="/sign-up" className="font-medium text-nomi-orange hover:text-nomi-orange-dark">
            Create an account
          </Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogle} disabled={isSubmitting} />
      <AuthDivider />
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <div>
          <AuthField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
          <Link
            to="/forgot-password"
            className="mt-1.5 inline-block text-xs font-medium text-ink-faint hover:text-nomi-orange-dark"
          >
            Forgot password?
          </Link>
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <AuthError>{error}</AuthError>
    </AuthCard>
  )
}
