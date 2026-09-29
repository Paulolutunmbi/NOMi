import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import NomiLogo from '../components/NomiLogo'
import ErrorState from '../components/ErrorState'
import { useAuth } from '../context/AuthContext'
import { markOnboarded } from '../utils/onboarding'
import { errorKindFor } from '../utils/errorKind'
import { getGoogleConnectUrl, fetchMe, updateCountry } from '../api/nomiClient'

function StepRow({ index, title, body, state, children }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            state === 'done'
              ? 'bg-success-tint text-success'
              : state === 'active'
                ? 'bg-nomi-orange text-white'
                : 'bg-surface-sunken text-ink-faint'
          }`}
        >
          {state === 'done' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            index
          )}
        </span>
        {index < 4 && <span className="mt-1 w-px flex-1 bg-line" aria-hidden="true" />}
      </div>
      <div className="flex-1 pb-8">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-faint">{body}</p>
        {children && <div className="mt-3">{children}</div>}
      </div>
    </div>
  )
}

export default function Onboarding() {
  const { user, googleConnected, refreshGoogleStatus } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isConnecting, setIsConnecting] = useState(false)
  const [error, setError] = useState(null)
  const [connectFailed, setConnectFailed] = useState(() => searchParams.get('google') === 'failed')

  // Only asked here for a Google sign-in, which skips the sign-up form's own
  // country field. undefined = still checking; null = none on file yet.
  const [country, setCountry] = useState(undefined)
  const [countryInput, setCountryInput] = useState('')
  const [countryError, setCountryError] = useState('')
  const [savingCountry, setSavingCountry] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMe().then((data) => { if (!cancelled) setCountry(data.user?.country || null) }).catch(() => { if (!cancelled) setCountry(null) })
    return () => { cancelled = true }
  }, [])

  const handleSaveCountry = async (event) => {
    event.preventDefault()
    if (!countryInput.trim()) { setCountryError('Enter your country.'); return }
    setCountryError('')
    setSavingCountry(true)
    try {
      await updateCountry(countryInput.trim())
      setCountry(countryInput.trim())
    } catch {
      setCountryError("NOMI didn't recognize that country. Try the full name, e.g. \"Nigeria\".")
    } finally {
      setSavingCountry(false)
    }
  }

  const googleParam = searchParams.get('google')

  useEffect(() => {
    if (!googleParam) return
    // Clear the flag from the URL once read (so a refresh doesn't re-show
    // it — connectFailed above already captured it for this render), and
    // re-check status in case it changed since the last load (i.e.
    // returning from the OAuth redirect).
    refreshGoogleStatus()
    setSearchParams(
      (params) => {
        params.delete('google')
        return params
      },
      { replace: true },
    )
  }, [googleParam, refreshGoogleStatus, setSearchParams])

  useEffect(() => {
    if (googleConnected) markOnboarded(user?.uid)
  }, [googleConnected, user?.uid])

  if (googleConnected) return <Navigate to="/app" replace />

  const handleConnect = async () => {
    setError(null)
    setConnectFailed(false)
    setIsConnecting(true)
    try {
      const url = await getGoogleConnectUrl()
      window.location.assign(url)
    } catch (connectError) {
      setError(connectError)
      setIsConnecting(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center bg-surface-muted px-4 py-10 sm:py-16">
      <NomiLogo size={36} />
      <div className="mt-8 w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-7">
        <h1 className="text-lg font-semibold text-ink">Welcome to NOMI</h1>
        <p className="mt-1.5 text-sm text-ink-faint">
          One more step before your workspace is ready.
        </p>

        <div className="mt-7">
          <StepRow index={1} state="done" title="NOMI account created" body={user?.email || 'Your account is ready.'} />
          <StepRow
            index={2}
            state={country ? 'active' : 'upcoming'}
            title="Set your country"
            body="Used to default the time zone for meetings NOMI creates for you. Change it anytime in Settings."
          >
            {country === undefined ? (
              <p className="text-sm text-ink-faint">Checking…</p>
            ) : country ? (
              <p className="text-sm text-ink">{country}</p>
            ) : (
              <form onSubmit={handleSaveCountry} className="flex flex-wrap items-start gap-2">
                <input
                  type="text"
                  value={countryInput}
                  onChange={(e) => setCountryInput(e.target.value)}
                  placeholder="e.g. Nigeria"
                  autoComplete="country-name"
                  className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-nomi-orange focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={savingCountry}
                  className="rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingCountry ? 'Saving…' : 'Save'}
                </button>
              </form>
            )}
            {countryError && <p className="mt-2 text-xs text-danger">{countryError}</p>}
          </StepRow>
          <StepRow
            index={3}
            state={country ? 'active' : 'upcoming'}
            title="Connect your Google account"
            body="NOMI needs permission to access Gmail and Calendar on your behalf. You'll choose exactly what to grant on Google's own screen."
          >
            {connectFailed && !error && (
              <div className="mb-3">
                <ErrorState kind="server" onRetry={handleConnect} />
              </div>
            )}
            {error && (
              <div className="mb-3">
                <ErrorState kind={errorKindFor(error)} onRetry={handleConnect} onReconnect={handleConnect} />
              </div>
            )}
            <button
              type="button"
              onClick={handleConnect}
              disabled={isConnecting || !country}
              className="rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConnecting ? 'Redirecting to Google…' : 'Connect Google account'}
            </button>
          </StepRow>
          <StepRow
            index={4}
            state="upcoming"
            title="Your NOMI workspace"
            body="Once connected, you can ask NOMI to search, draft, and manage your calendar."
          />
        </div>
      </div>
    </div>
  )
}
