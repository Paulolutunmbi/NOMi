import { NavLink } from 'react-router-dom'
import NomiLogo, { NomiMark } from './NomiLogo'
import NetworkBanner from './NetworkBanner'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/gmail', label: 'Gmail', icon: MailIcon },
  { to: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
]

function HomeIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><path d="M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function MailIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><rect x="3.5" y="5.5" width="17" height="13" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="m4.5 7 6.6 5a1.6 1.6 0 0 0 1.9 0l6.6-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function CalendarIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><rect x="3.5" y="5" width="17" height="15" rx="2" stroke="currentColor" strokeWidth="1.7" /><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
}
function SettingsIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2.2M18.8 12H21M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
}

function NavItem({ to, label, icon: Icon, className }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
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

export default function AppShell({ children, userLabel, onSignOut }) {
  return (
    <div className="flex h-svh flex-col bg-surface-muted">
      <NetworkBanner />
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

        {/* Mobile top bar */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 sm:hidden">
            <NomiMark size={26} />
            <span className="text-sm font-semibold text-ink">NOMI</span>
            <span className="w-6" />
          </header>
          <main className="flex-1 overflow-hidden">{children}</main>
          {/* Mobile bottom nav */}
          <nav className="grid grid-cols-4 border-t border-line bg-surface px-2 py-1.5 sm:hidden">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} className="flex-col gap-1 px-1 py-1.5 text-[11px]" />
            ))}
          </nav>
        </div>
      </div>
    </div>
  )
}
