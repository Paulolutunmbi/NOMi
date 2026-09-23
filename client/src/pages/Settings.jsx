import { useEffect, useState } from 'react'
import {
  disconnectGoogle,
  fetchGoogleStatus,
  fetchPermissions,
  getGoogleConnectUrl,
  revokePermission,
} from '../api/nomiClient'
import { friendlyPermission } from '../utils/actionLabels'
import ErrorState from '../components/ErrorState'

function Section({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description && <p className="mt-1 text-xs text-ink-faint">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default function Settings() {
  const [connection, setConnection] = useState(undefined)
  const [permissions, setPermissions] = useState(undefined)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setError(null)
    try {
      const [statusData, permissionData] = await Promise.all([fetchGoogleStatus(), fetchPermissions()])
      setConnection(statusData)
      setPermissions(permissionData.permissions || [])
    } catch {
      setError('server')
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([fetchGoogleStatus(), fetchPermissions()])
      .then(([statusData, permissionData]) => {
        if (!active) return
        setConnection(statusData)
        setPermissions(permissionData.permissions || [])
      })
      .catch(() => { if (active) setError('server') })
    return () => { active = false }
  }, [])

  const handleConnect = async () => {
    setBusy(true)
    try {
      const url = await getGoogleConnectUrl()
      window.location.assign(url)
    } catch {
      setError('server')
      setBusy(false)
    }
  }

  const handleDisconnect = async () => {
    setBusy(true)
    try {
      await disconnectGoogle()
      await load()
    } catch {
      setError('server')
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (permission) => {
    setBusy(true)
    try {
      await revokePermission(permission)
      await load()
    } catch {
      setError('server')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto h-full max-w-2xl overflow-y-auto px-4 py-8 sm:px-8">
      <h1 className="text-lg font-semibold text-ink">Settings</h1>
      <p className="mt-1 text-sm text-ink-faint">What NOMI can access, and on your behalf.</p>

      <div className="mt-6 space-y-4">
        {error && <ErrorState kind={error} onRetry={load} onReconnect={handleConnect} />}

        <Section title="Google account" description="Connect Google so NOMI can work with your Gmail and Calendar.">
          {connection === undefined && <p className="text-sm text-ink-faint">Checking connection…</p>}
          {connection?.connected && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink">{connection.account?.email}</p>
                <p className="text-xs text-ink-faint">Connected</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={handleDisconnect}
                className="rounded-lg border border-line-strong px-3 py-1.5 text-sm font-medium text-ink-soft transition-colors hover:border-danger hover:text-danger disabled:opacity-60"
              >
                Disconnect
              </button>
            </div>
          )}
          {connection && !connection.connected && (
            <button
              type="button"
              disabled={busy}
              onClick={handleConnect}
              className="rounded-lg bg-nomi-orange px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark disabled:opacity-60"
            >
              Connect Google
            </button>
          )}
        </Section>

        <Section
          title="Always-allowed actions"
          description="Removing one just means NOMI will ask again next time — it won't disconnect Google or affect anything else."
        >
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
        </Section>
      </div>
    </div>
  )
}
