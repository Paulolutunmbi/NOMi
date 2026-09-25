import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ChatMessage from '../components/ChatMessage'
import Composer from '../components/Composer'
import EmptyState from '../components/EmptyState'
import ProcessingIndicator from '../components/ProcessingIndicator'
import { useNomiConversation } from '../hooks/useNomiConversation'
import { createChat, getGoogleConnectUrl, listChats } from '../api/nomiClient'

export default function Workspace({
  workspaceType,
  placeholder,
  emptyTitle,
  emptyBody,
  suggestions = [],
}) {
  const { chatId: selectedChatId } = useParams()
  const navigate = useNavigate()
  const [chats, setChats] = useState([])
  const [listError, setListError] = useState(false)
  const { turns, chatId, isProcessing, processingLabel, send, selectCandidate, respondApproval, retryLast } =
    useNomiConversation(workspaceType, selectedChatId)
  const scrollRef = useRef(null)

  useEffect(() => {
    let active = true
    listChats(workspaceType)
      .then(({ chats: items }) => { if (active) { setChats(items || []); setListError(false) } })
      .catch(() => { if (active) setListError(true) })
    return () => { active = false }
  }, [workspaceType, turns.length])

  const newChat = async () => {
    try {
      const { chat } = await createChat(workspaceType)
      setChats((prev) => [chat, ...prev.filter((item) => item.id !== chat.id)])
      navigate(`/app/${workspaceType}/chat/${chat.id}`)
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

  return (
    <div className="flex h-full min-h-0 flex-col md:flex-row">
      <aside className="w-full shrink-0 border-b border-line bg-surface-muted p-3 md:w-64 md:border-b-0 md:border-r md:p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-ink">{workspaceType === 'gmail' ? 'Gmail' : workspaceType === 'calendar' ? 'Calendar' : 'NOMI'}</h1>
          <button type="button" onClick={newChat} className="rounded-lg bg-nomi-orange px-3 py-2 text-sm font-medium text-white hover:bg-nomi-orange-dark">+ New Chat</button>
        </div>
        <h2 className="mt-5 hidden text-xs font-semibold uppercase tracking-wide text-ink-faint md:block">Recent chats</h2>
        <nav className="mt-2 flex gap-2 overflow-x-auto md:flex-col md:overflow-x-visible" aria-label={`${workspaceType} chats`}>
          {chats.map((chat) => <button key={chat.id} type="button" onClick={() => navigate(`/app/${workspaceType}/chat/${chat.id}`)} className={`max-w-52 shrink-0 truncate rounded-lg px-3 py-2 text-left text-sm md:max-w-none ${chat.id === selectedChatId ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:bg-surface'}`}>{chat.title || 'New conversation'}</button>)}
          {!chats.length && !listError && <p className="hidden px-1 py-2 text-sm text-ink-faint md:block">No chats yet. Start a new conversation.</p>}
          {listError && <p className="px-1 py-2 text-xs text-ink-faint">Chat list unavailable.</p>}
        </nav>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!selectedChatId ? <div className="flex flex-1 flex-col items-center justify-center p-8 text-center"><h2 className="text-xl font-semibold text-ink">{workspaceType === 'gmail' ? 'Your Gmail workspace' : 'Your Calendar workspace'}</h2><p className="mt-2 max-w-sm text-sm text-ink-soft">Choose a chat or start a new conversation with NOMI.</p><button type="button" onClick={newChat} className="mt-5 rounded-lg bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white">+ New Chat</button></div> : <>
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
              onRetry={retryLast}
              onReconnect={handleReconnect}
            />
          ))}
          {isProcessing && <ProcessingIndicator label={processingLabel} />}
        </div>
      )}
      <div className="border-t border-line bg-surface-muted p-3 sm:p-4">
        <Composer placeholder={placeholder} disabled={isProcessing} onSend={send} chatId={chatId} />
      </div>
      </>}
      </section>
    </div>
  )
}
