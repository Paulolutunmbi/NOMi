import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthCard, { AuthError } from '../components/AuthCard'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../context/AuthContext'
import { acceptLegalTerms } from '../api/nomiClient'
import { hasOnboarded } from '../utils/onboarding'

export default function LegalAcceptance() {
  const { user, googleConnected, refreshLegalStatus } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const continueToNomi = async () => {
    setError('')
    setSaving(true)
    try {
      await acceptLegalTerms()
      const refreshed = await refreshLegalStatus()
      const requested = location.state?.from?.pathname
      const hasGoogleAccount = refreshed?.connectedAccounts?.some((account) => account.provider === 'google') || googleConnected
      navigate(requested?.startsWith('/app') ? requested : hasGoogleAccount || hasOnboarded(user?.uid) ? '/app' : '/onboarding', { replace: true })
    } catch {
      setError('We couldn’t save your acceptance. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  if (saving) return <LoadingScreen label="Saving your acceptance…" />

  return (
    <AuthCard title="Before you continue" subtitle="Please review and accept NOMI’s Terms of Service and Privacy Policy to continue using NOMI.">
      <div className="space-y-5">
        <p className="text-sm text-ink-soft">Read the <Link to="/terms" className="font-medium text-nomi-orange hover:underline">Terms of Service</Link> and <Link to="/privacy" className="font-medium text-nomi-orange hover:underline">Privacy Policy</Link>.</p>
        <label className="flex cursor-pointer items-start gap-3 text-sm leading-6 text-ink-soft">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} className="mt-1 accent-nomi-orange" />
          <span>I agree to NOMI’s Terms of Service and Privacy Policy.</span>
        </label>
        <AuthError>{error}</AuthError>
        <button type="button" onClick={continueToNomi} disabled={!checked || saving} className="w-full rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-50">
          Continue
        </button>
      </div>
    </AuthCard>
  )
}
