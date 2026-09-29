import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  disconnectGoogle,
  fetchMe,
  fetchPermissions,
  getGoogleConnectUrl,
  revokePermission,
  updateCountry,
} from '../api/nomiClient'
import { friendlyPermission } from '../utils/actionLabels'
import { summarizeGoogleScopes } from '../utils/googleScopes'
import { errorKindFor } from '../utils/errorKind'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import ErrorState from '../components/ErrorState'
import Modal from '../components/Modal'

function Section({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-xs text-ink-faint">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

function AccessBadge({ label, granted }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        granted ? 'bg-success-tint text-success' : 'bg-surface-sunken text-ink-faint'
      }`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        {granted ? (
          <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        )}
      </svg>
      {label}
    </span>
  )
}

function initials(source) {
  return (source || '?').trim().slice(0, 1).toUpperCase()
}

export default function Settings() {
  const { user, googleStatus, googleStatusLoading, refreshGoogleStatus, signOut } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const [permissions, setPermissions] = useState(undefined)
  const [permissionsError, setPermissionsError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [connectError, setConnectError] = useState(null)
  const [showComingSoon, setShowComingSoon] = useState(false)

  const [country, setCountry] = useState(null)
  const [meLoading, setMeLoading] = useState(true)
  const [editingCountry, setEditingCountry] = useState(false)
  const [countryInput, setCountryInput] = useState('')
  const [countryError, setCountryError] = useState('')
  const [savingCountry, setSavingCountry] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchMe()
      .then((data) => { if (!cancelled) setCountry(data.user?.country || null) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setMeLoading(false) })
    return () => { cancelled = true }
  }, [])

  const handleSaveCountry = async (event) => {
    event.preventDefault()
    if (!countryInput.trim()) { setCountryError('Enter a country.'); return }
    setCountryError('')
    setSavingCountry(true)
    try {
      await updateCountry(countryInput.trim())
      setCountry(countryInput.trim())
      setEditingCountry(false)
    } catch {
      setCountryError("NOMI didn't recognize that country. Try the full name, e.g. \"Nigeria\".")
    } finally {
      setSavingCountry(false)
    }
  }

  const loadPermissions = async () => {
    setPermissionsError(null)
    try {
      const data = await fetchPermissions()
      setPermissions(data.permissions || [])
    } catch (error) {
      setPermissionsError(errorKindFor(error))
    }
  }

  useEffect(() => {
    let cancelled = false
    fetchPermissions()
      .then((data) => {
        if (!cancelled) setPermissions(data.permissions || [])
      })
      .catch((error) => {
        if (!cancelled) setPermissionsError(errorKindFor(error))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleConnect = async () => {
    setConnectError(null)
    setBusy(true)
    try {
      const url = await getGoogleConnectUrl()
      window.location.assign(url)
    } catch (error) {
      setConnectError(errorKindFor(error))
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    try {
      await disconnectGoogle()
      await refreshGoogleStatus()
    } catch (error) {
      setConnectError(errorKindFor(error))
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (permission) => {
    setBusy(true)
    try {
      await revokePermission(permission)
      await loadPermissions()
    } catch (error) {
      setPermissionsError(errorKindFor(error))
    } finally {
      setBusy(false)
    }
  }

  const handleSignOut = async () => {
    await signOut()
    navigate('/', { replace: true })
  }

  const account = googleStatus?.account
  const access = summarizeGoogleScopes(account?.scopes)
  const signInMethod = user?.providerData?.[0]?.providerId === 'google.com' ? 'Google' : 'Email and password'

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8 sm:px-8">
      <h1 className="text-lg font-semibold text-ink">Settings</h1>
      <p className="mt-1 text-sm text-ink-faint">Your NOMI account, what it's connected to, and what it can access.</p>

      <div className="mt-6 space-y-4">
        {/* Account */}
        <Section title="Account" description="Your NOMI account — separate from any Google account you connect below.">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nomi-orange-light text-sm font-semibold text-nomi-orange-dark">
                {initials(user?.displayName || user?.email)}
              </span>
              <div>
                <p className="text-sm font-medium text-ink">{user?.displayName || 'NOMI user'}</p>
                <p className="text-xs text-ink-faint">{user?.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:border-danger hover:text-danger"
            >
              Log out
            </button>
          </div>
        </Section>

        {/* Location & time zone */}
        <Section
          title="Location & time zone"
          description="Meetings NOMI creates for you default to this country's time zone unless you say otherwise."
        >
          {meLoading && <p className="text-sm text-ink-faint">Loading…</p>}
          {!meLoading && !editingCountry && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-ink">{country || 'Not set'}</p>
              <button
                type="button"
                onClick={() => { setCountryInput(country || ''); setCountryError(''); setEditingCountry(true) }}
                className="shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:border-nomi-orange hover:text-nomi-orange"
              >
                {country ? 'Change' : 'Set country'}
              </button>
            </div>
          )}
          {!meLoading && editingCountry && (
            <form onSubmit={handleSaveCountry} className="flex flex-wrap items-start gap-2">
              <input
                type="text"
                value={countryInput}
                onChange={(e) => setCountryInput(e.target.value)}
                placeholder="e.g. Nigeria"
                autoComplete="country-name"
                autoFocus
                className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:border-nomi-orange focus:outline-none"
              />
              <button
                type="submit"
                disabled={savingCountry}
                className="rounded-xl bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingCountry ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => { setEditingCountry(false); setCountryError('') }}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-ink-faint hover:text-ink"
              >
                Cancel
              </button>
            </form>
          )}
          {countryError && <p className="mt-2 text-xs text-danger">{countryError}</p>}
        </Section>

        {/* Connected Accounts */}
        <Section
          title="Connected accounts"
          description="The Google account NOMI uses for Gmail and Calendar. This is separate from your NOMI account above."
        >
          {connectError && (
            <div className="mb-3">
              <ErrorState kind={connectError} onRetry={handleConnect} onReconnect={handleConnect} />
            </div>
          )}

          {googleStatusLoading && <p className="text-sm text-ink-faint">Checking connection…</p>}

          {!googleStatusLoading && googleStatus?.connected && (
            <div className="rounded-xl border border-line bg-surface-muted p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-nomi-orange-light text-sm font-semibold text-nomi-orange-dark">
                    {initials(account?.displayName || account?.email)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink" title={account?.email}>{account?.email}</p>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-success">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                      Connected
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleDisconnect}
                  className="w-full shrink-0 rounded-lg border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-danger hover:text-danger disabled:opacity-60 sm:w-auto"
                >
                  Disconnect
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <AccessBadge label="Gmail access" granted={access.gmail} />
                <AccessBadge label="Calendar access" granted={access.calendar} />
              </div>
            </div>
          )}

          {!googleStatusLoading && googleStatus && !googleStatus.connected && (
            <button
              type="button"
              disabled={busy}
              onClick={handleConnect}
              className="rounded-lg bg-nomi-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:opacity-60"
            >
              Connect Google account
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowComingSoon(true)}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3.5 py-2.5 text-sm font-medium text-ink-faint transition-colors hover:border-nomi-orange hover:text-nomi-orange-dark"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            Add Gmail account
          </button>
        </Section>

        {/* Appearance */}
        <Section title="Appearance" description="Choose how NOMI looks on this device.">
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'system', label: 'System' },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                aria-pressed={theme === option.value}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                  theme === option.value
                    ? 'border-nomi-orange bg-nomi-orange-tint text-nomi-orange-dark'
                    : 'border-line text-ink-soft hover:border-line-strong'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Permissions / Privacy */}
        <Section
          title="Permissions & privacy"
          description="NOMI only reads or changes Gmail and Calendar data you've connected, and only after you approve each action — or mark it always-allowed below."
        >
          {permissionsError && (
            <div className="mb-3">
              <ErrorState kind={permissionsError} onRetry={loadPermissions} />
            </div>
          )}
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">Always-allowed actions</p>
          <p className="mt-1 text-xs text-ink-faint">
            Removing one just means NOMI will ask again next time — it won't disconnect Google or affect anything else.
          </p>
          <div className="mt-3">
            {permissions === undefined && <p className="text-sm text-ink-faint">Loading…</p>}
            {permissions?.length === 0 && <p className="text-sm text-ink-faint">No always-allowed actions yet.</p>}
            {permissions && permissions.length > 0 && (
              <ul className="divide-y divide-line">
                {permissions.map((permission) => (
                  <li key={`${permission.provider}:${permission.action}`} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm text-ink">{friendlyPermission(permission.action)}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRevoke(permission)}
                      className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-ink-faint transition-colors hover:text-danger disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {/* Security */}
        <Section title="Security" description="How your NOMI account is protected.">
          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-faint">Signed in with</dt>
              <dd className="font-medium text-ink">{signInMethod}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-faint">Google access tokens</dt>
              <dd className="font-medium text-ink">Encrypted at rest</dd>
            </div>
          </dl>
        </Section>

        {/* About */}
        <Section title="About">
          <p className="text-sm text-ink">NOMI</p>
          <p className="mt-1 text-sm text-ink-faint">
            Your intelligent workspace for email and calendar. NOMI is not affiliated with Google.
          </p>
        </Section>
      </div>

      <Modal open={showComingSoon} onClose={() => setShowComingSoon(false)} title="Multiple Gmail accounts">
        Multiple Gmail accounts are coming soon. For now, NOMI supports one connected Google account at a time —
        you can switch which one is connected any time from this page.
      </Modal>
    </div>
  )
}
