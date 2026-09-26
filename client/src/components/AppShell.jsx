import { Link, NavLink } from 'react-router-dom'
import NomiLogo from './NomiLogo'
import NetworkBanner from './NetworkBanner'
import { useAuth } from '../context/AuthContext'

const NAV_ITEMS = [
  { to: '/app', label: 'Chat', icon: HomeIcon },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
]

function HomeIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><path d="M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function SettingsIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2.2M18.8 12H21M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
}

function NavItem({ to, label, icon: Icon, className }) {
  return (
    <NavLink
      to={to}
      end={to === '/app'}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-nomi-orange-tint text-nomi-orange-dark' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
        } ${className || ''}`
      }
    >
      <Icon />
      <span>{label}</span>
    </NavLink>
  )
}

function GoogleDisconnectedBanner() {
  const { googleConnected, googleStatusLoading } = useAuth()
  if (googleStatusLoading || googleConnected) return null
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-2 bg-warning-tint px-4 py-2 text-center text-xs font-medium text-warning"
    >
      <span>Google isn't connected — Gmail and Calendar actions won't work yet.</span>
      <Link to="/app/settings" className="underline hover:no-underline">
        Connect in Settings
      </Link>
    </div>
  )
}

export default function AppShell({ children, userLabel, onSignOut }) {
  return (
    <div className="flex h-svh flex-col bg-surface-muted">
      <NetworkBanner />
      <GoogleDisconnectedBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
          <div className="px-1 pb-6">
            <NomiLogo />
          </div>
          <nav className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => <NavItem key={item.to} {...item} />)}
          </nav>
          <div className="mt-auto space-y-1 border-t border-line pt-3 text-xs text-ink-faint">
            {userLabel && <p className="truncate px-1">{userLabel}</p>}
            {onSignOut && (
              <button type="button" onClick={onSignOut} className="w-full rounded-lg px-1 py-1.5 text-left text-xs font-medium text-ink-faint hover:text-danger">
                Sign out
              </button>
            )}
          </div>
        </aside>

        {/* Mobile: Workspace renders its own header (hamburger, title, new chat),
            so AppShell only needs the bottom nav here. */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <main className="flex-1 overflow-hidden">{children}</main>
          {/* Mobile bottom nav */}
          <nav className="grid grid-cols-2 border-t border-line bg-surface px-2 py-1.5 sm:hidden">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} className="flex-col gap-1 px-1 py-1.5 text-[11px]" />
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
