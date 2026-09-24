import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthCard, { AuthError, AuthField } from '../components/AuthCard'
import { friendlyAuthError, sendPasswordResetEmail } from '../services/auth'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)
    try {
      await sendPasswordResetEmail(email.trim())
      setSent(true)
    } catch (submitError) {
      // Firebase intentionally reports "user not found" here too in some
      // configurations; either way we don't want to reveal which emails
      // have NOMI accounts, so a generic success-style message is safer —
      // but a malformed email or network failure should still be explained.
      if (submitError?.code === 'auth/invalid-email' || submitError?.code === 'auth/network-request-failed') {
        setError(friendlyAuthError(submitError))
      } else {
        setSent(true)
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  if (sent) {
    return (
      <AuthCard
        title="Check your email"
        subtitle={`If an account exists for ${email.trim()}, we've sent a link to reset the password.`}
        footer={
          <Link to="/sign-in" className="font-medium text-nomi-orange hover:text-nomi-orange-dark">
            Back to sign in
          </Link>
        }
      >
        <p className="text-sm text-ink-faint">
          The link will take you back to NOMI to set a new password. It may take a minute to arrive.
        </p>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email for your NOMI account and we'll send you a reset link."
      footer={
        <Link to="/sign-in" className="font-medium text-nomi-orange hover:text-nomi-orange-dark">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </button>
      </form>
      <AuthError>{error}</AuthError>
    </AuthCard>
  )
}
