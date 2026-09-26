import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ChatMessage from '../components/ChatMessage'
import Composer from '../components/Composer'
import EmptyState from '../components/EmptyState'
import ProcessingIndicator from '../components/ProcessingIndicator'
import { useNomiConversation } from '../hooks/useNomiConversation'
import { createChat, getGoogleConnectUrl, listAllChats } from '../api/nomiClient'

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

function HamburgerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

export default function Workspace({ placeholder, emptyTitle, emptyBody, suggestions = [] }) {
  const { chatId: selectedChatId } = useParams()
  const navigate = useNavigate()
  const [chats, setChats] = useState([])
  const [listError, setListError] = useState(false)
  const { turns, chatId, isProcessing, processingLabel, send, selectCandidate, respondApproval, editSendDraft, retryLast } =
    useNomiConversation(selectedChatId)
  const scrollRef = useRef(null)
  // "Reply" / "Message <sender>" buttons on a read email set this to pre-fill
  // and focus the composer, rather than sending anything themselves — the
  // user still reviews and finishes the message before it goes anywhere.
  const [draftText, setDraftText] = useState(null)
  const composeHint = (text) => setDraftText({ text, token: `${Date.now()}-${Math.random()}` })
  // Chat history lives in a hidden-by-default drawer, opened with the
  // hamburger button — it never occupies space above the chat itself.
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // One unified list — mail, calendar, and everything else all live in the
  // same chats now, so there's nothing left to filter by type.
  useEffect(() => {
    let active = true
    listAllChats()
      .then(({ chats: items }) => { if (active) { setChats(items || []); setListError(false) } })
      .catch(() => { if (active) setListError(true) })
    return () => { active = false }
  }, [turns.length])

  const newChat = async () => {
    try {
      const { chat } = await createChat('home')
      setChats((prev) => [chat, ...prev.filter((item) => item.id !== chat.id)])
      setSidebarOpen(false)
      navigate(`/app/chat/${chat.id}`)
    } catch { setListError(true) }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, isProcessing])

  const handleReconnect = async () => {
    try {
      const url = await getGoogleConnectUrl()
      window.location.assign(url)
    } catch {
      // Surfaced as a normal error turn on the next attempt; nothing to do here.
    }
  }

  const goToChat = (path) => {
    setSidebarOpen(false)
    navigate(path)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open chat history"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <HamburgerIcon />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-ink">NOMI</h1>
        <button type="button" onClick={newChat} className="shrink-0 rounded-lg bg-nomi-orange px-3 py-2 text-sm font-medium text-white hover:bg-nomi-orange-dark">+ New Chat</button>
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close chat history"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-ink/30"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r border-line bg-surface-muted p-4 shadow-card-hover transition-transform duration-200 ease-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Chat history</h2>
            <button type="button" onClick={() => setSidebarOpen(false)} aria-label="Close chat history" className="rounded-lg p-1.5 text-ink-faint hover:bg-surface hover:text-ink">
              <CloseIcon />
            </button>
          </div>
          <nav className="mt-4 flex flex-col gap-1" aria-label="Chats">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => goToChat(`/app/chat/${chat.id}`)}
                className={`flex items-center gap-2 truncate rounded-lg px-3 py-2 text-left text-sm ${chat.id === selectedChatId ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:bg-surface'}`}
              >
                <WorkspaceIcon type={chat.type} />
                <span className="min-w-0 flex-1 truncate">{chat.title || 'New conversation'}</span>
              </button>
            ))}
            {!chats.length && !listError && <p className="px-1 py-2 text-sm text-ink-faint">No chats yet. Start a new conversation.</p>}
            {listError && <p className="px-1 py-2 text-xs text-ink-faint">Chat list unavailable.</p>}
          </nav>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!selectedChatId ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><h2 className="text-xl font-semibold text-ink">Your NOMI workspace</h2><p className="mt-2 max-w-sm text-sm text-ink-soft">Choose a chat or start a new conversation with NOMI.</p><button type="button" onClick={newChat} className="mt-5 rounded-lg bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white">+ New Chat</button></div> : <>
          {turns.length === 0 ? (
            <div className="flex-1 overflow-y-auto">
              <EmptyState title={emptyTitle} body={emptyBody} suggestions={suggestions} onSuggestion={send} />
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-8">
              {turns.map((turn, index) => (
                <ChatMessage
                  key={turn.id}
                  turn={turn}
                  isLatest={index === turns.length - 1}
                  busy={isProcessing}
                  onSelectCandidate={selectCandidate}
                  onDecideApproval={respondApproval}
                  onEditSendDraft={editSendDraft}
                  onRetry={retryLast}
                  onReconnect={handleReconnect}
                  onComposeHint={composeHint}
                />
              ))}
              {isProcessing && <ProcessingIndicator label={processingLabel} />}
            </div>
          )}
          <div className="border-t border-line bg-surface-muted p-3 sm:p-4">
            <Composer placeholder={placeholder} disabled={isProcessing} onSend={send} chatId={chatId} draftText={draftText} />
          </div>
          </>}
        </section>
      </div>
    </div>
  )
}
