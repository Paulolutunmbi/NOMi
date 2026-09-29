import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthCard, { AuthDivider, AuthError, AuthField, GoogleButton } from '../components/AuthCard'
import { friendlyAuthError, registerWithEmailAndPassword, signInWithGoogle } from '../services/auth'
import { isCountryRecognized, updateCountry } from '../api/nomiClient'

export default function SignUp() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (!country.trim()) {
      setError('Enter your country.')
      return
    }

    setIsSubmitting(true)
    try {
      // Catch a mistyped country now: it decides the time zone of every
      // event NOMI creates, so it shouldn't silently fall back to a default.
      if (!(await isCountryRecognized(country.trim()))) {
        setError("NOMI doesn't recognize that country. Try the full name, e.g. \"Nigeria\".")
        setIsSubmitting(false)
        return
      }
      await registerWithEmailAndPassword(email.trim(), password, name.trim())
      // Best-effort: this sets the default time zone for calendar events.
      // If it fails, Onboarding asks again before the workspace opens.
      await updateCountry(country.trim()).catch(() => {})
      navigate('/', { replace: true })
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
      navigate('/', { replace: true })
    } catch (submitError) {
      setError(friendlyAuthError(submitError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthCard
      title="Create your NOMI account"
      subtitle="This is your account for NOMI itself. You'll connect Gmail and Calendar separately, right after."
      footer={
        <>
          Already have a NOMI account?{' '}
          <Link to="/sign-in" className="font-medium text-nomi-orange hover:text-nomi-orange-dark">
            Sign in
          </Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogle} disabled={isSubmitting} />
      <AuthDivider />
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          placeholder="Optional"
        />
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <AuthField
          label="Country"
          type="text"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          autoComplete="country-name"
          placeholder="e.g. Nigeria"
          required
        />
        <p className="-mt-2 text-xs text-ink-faint">Used to default the time zone for meetings NOMI creates for you.</p>
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <AuthField
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          minLength={6}
          required
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Creating your account…' : 'Create account'}
        </button>
      </form>
      <AuthError>{error}</AuthError>
    </AuthCard>
  )
}
