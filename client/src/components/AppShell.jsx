import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import NomiLogo from './NomiLogo'
import NetworkBanner from './NetworkBanner'
import InstallBanner from './InstallBanner'
import { useAuth } from '../context/AuthContext'
import { useChatSidebar } from '../context/ChatSidebarContext'

function SettingsIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" {...props}><circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.7" /><path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M3 12h2.2M18.8 12H21M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
}
function PlusIcon(props) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" {...props}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
}
function HamburgerIcon(props) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}
function TrashIcon(props) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
function CloseIcon(props) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
}

// Cosmetic only — a small hint next to older chats created back when Gmail
// and Calendar were separate tabs. Every chat can do both now regardless of
// this label; it's just a memory aid for chats started before the merge.
function WorkspaceIcon({ type }) {
  if (type === 'calendar') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-ink-faint">
        <rect x="3.5" y="4.5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 9.5h17M8 3v3M16 3v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  if (type === 'gmail') {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-ink-faint">
        <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
        <path d="m4 6.5 8 6 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return null
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

// The single source of chat navigation: a "+ New Chat" action, the list of
// existing chats (most recent first, as the server returns them), and the
// rest of the app's top-level nav (Settings). This is shared verbatim
// between the always-visible desktop sidebar and the mobile drawer so the
// two never drift into two different navigation experiences again.
function SidebarContent({ onNavigate }) {
  const { chats, listError, selectedChatId, newChat, goToChat, removeChat } = useChatSidebar()
  // Two-step delete: first tap on the trash icon arms it ("Delete?"), second
  // tap confirms. Prevents wiping a conversation with one stray tap.
  const [confirmingId, setConfirmingId] = useState(null)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const confirmDelete = async (chatId) => {
    setConfirmingId(null)
    const ok = await removeChat(chatId)
    setDeleteFailed(!ok)
  }
  return (
    <>
      <Link to="/app" onClick={onNavigate} className="block px-1 pb-5">
        <NomiLogo />
      </Link>
      <button
        type="button"
        onClick={async () => { await newChat(); onNavigate?.() }}
        className="mb-4 flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-nomi-orange px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-nomi-orange-dark"
      >
        <PlusIcon /> New Chat
      </button>
      <p className="mb-1 shrink-0 px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Chat history</p>
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Chats">
        {chats.map((chat) => (
          <div
            key={chat.id}
            className={`group flex w-full items-center rounded-lg text-sm ${chat.id === selectedChatId ? 'bg-surface-sunken text-ink shadow-sm' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'}`}
          >
            <button
              type="button"
              onClick={() => { setConfirmingId(null); goToChat(chat.id); onNavigate?.() }}
              className="flex min-w-0 flex-1 items-center gap-2 truncate px-3 py-2 text-left"
            >
              <WorkspaceIcon type={chat.type} />
              <span className="min-w-0 flex-1 truncate">{chat.title || 'New conversation'}</span>
            </button>
            {confirmingId === chat.id ? (
              <span className="flex shrink-0 items-center gap-1 pr-2 text-xs">
                <button type="button" onClick={() => confirmDelete(chat.id)} className="rounded px-1.5 py-0.5 font-medium text-danger hover:underline">Delete?</button>
                <button type="button" onClick={() => setConfirmingId(null)} className="rounded px-1.5 py-0.5 text-ink-faint hover:underline">Cancel</button>
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Delete chat: ${chat.title || 'New conversation'}`}
                onClick={() => { setDeleteFailed(false); setConfirmingId(chat.id) }}
                className="mr-1 shrink-0 rounded p-1.5 text-ink-faint opacity-100 transition-opacity hover:text-danger focus:opacity-100 md:opacity-0 md:group-hover:opacity-100"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
        {!chats.length && !listError && <p className="px-1 py-2 text-sm text-ink-faint">No chats yet. Start a new conversation.</p>}
        {listError && <p className="px-1 py-2 text-xs text-ink-faint">Chat list unavailable.</p>}
        {deleteFailed && <p role="alert" className="px-1 py-2 text-xs text-danger">Couldn't delete that chat. Try again.</p>}
      </nav>
      <div className="mt-3 shrink-0 space-y-1 border-t border-line pt-3">
        <NavLink
          to="/app/settings"
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
              isActive ? 'bg-nomi-orange-tint text-nomi-orange-dark' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'
            }`
          }
        >
          <SettingsIcon />
          <span>Settings</span>
        </NavLink>
      </div>
    </>
  )
}

function AccountFooter({ userLabel, onSignOut }) {
  if (!userLabel && !onSignOut) return null
  return (
    <div className="mt-3 shrink-0 space-y-1 border-t border-line pt-3 text-xs text-ink-faint">
      {userLabel && <p className="truncate px-1">{userLabel}</p>}
      {onSignOut && (
        <button type="button" onClick={onSignOut} className="w-full rounded-lg px-1 py-1.5 text-left text-xs font-medium text-ink-faint hover:text-danger">
          Sign out
        </button>
      )}
    </div>
  )
}

export default function AppShell({ children, userLabel, onSignOut }) {
  const { mobileOpen, setMobileOpen } = useChatSidebar()

  return (
    <div className="flex h-svh flex-col bg-surface-muted">
      <NetworkBanner />
      <InstallBanner />
      <GoogleDisconnectedBanner />
      <div className="flex flex-1 overflow-hidden">
        {/* The one sidebar, always visible on desktop. */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-surface p-4 sm:flex">
          <SidebarContent />
          <AccountFooter userLabel={userLabel} onSignOut={onSignOut} />
        </aside>

        {/* Mobile: the same sidebar content, as a drawer behind a hamburger. */}
        {mobileOpen && (
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-ink/30 sm:hidden"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-hidden border-r border-line bg-surface p-4 shadow-card-hover transition-transform duration-200 ease-out sm:hidden ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="mb-1 flex shrink-0 items-center justify-end">
            <button type="button" onClick={() => setMobileOpen(false)} aria-label="Close menu" className="rounded-lg p-1.5 text-ink-faint hover:bg-surface-sunken hover:text-ink">
              <CloseIcon />
            </button>
          </div>
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
          <AccountFooter userLabel={userLabel} onSignOut={onSignOut} />
        </aside>

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile top bar: hamburger opens the one drawer above. */}
          <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open chat history"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
            >
              <HamburgerIcon />
            </button>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">NOMI</h1>
          </div>
          <main className="flex-1 overflow-hidden">{children}</main>
        </div>
      </div>
    </div>
  )
}
