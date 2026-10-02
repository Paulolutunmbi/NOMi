import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import ChatMessage from '../components/ChatMessage'
import Composer from '../components/Composer'
import EmptyState from '../components/EmptyState'
import ProcessingIndicator from '../components/ProcessingIndicator'
import { useNomiConversation } from '../hooks/useNomiConversation'
import { useChatSidebar } from '../context/ChatSidebarContext'
import { getGoogleConnectUrl } from '../api/nomiClient'

export default function Workspace({ placeholder, emptyTitle, emptyBody, suggestions = [], prefill = null }) {
  const { chatId: selectedChatId } = useParams()
  const { setSelectedChatId, refreshChats, newChat } = useChatSidebar()
  const { turns, chatId, isProcessing, processingLabel, send, selectCandidate, respondApproval, editSendDraft, retryLast } =
    useNomiConversation(selectedChatId)
  const scrollRef = useRef(null)
  // "Reply" / "Message <sender>" buttons on a read email set this to pre-fill
  // and focus the composer, rather than sending anything themselves — the
  // user still reviews and finishes the message before it goes anywhere.
  const [draftText, setDraftText] = useState(null)
  const composeHint = (text) => setDraftText({ text, token: `${Date.now()}-${Math.random()}` })
  // Text handed in by a parent (e.g. "Ask NOMI" on a calendar item) lands in
  // the composer for the person to review — it is never sent automatically.
  useEffect(() => {
    if (prefill?.text) setDraftText(prefill)
  }, [prefill])

  // The chat-history sidebar lives in AppShell (a route ancestor), so it
  // can't read this route's :chatId param itself — report it up instead,
  // and clear it on unmount so switching away from a chat doesn't leave a
  // stale highlight.
  useEffect(() => {
    setSelectedChatId(selectedChatId || null)
    return () => setSelectedChatId(null)
  }, [selectedChatId, setSelectedChatId])

  // Chat titles/previews can change as a conversation progresses — keep the
  // sidebar's list in sync.
  useEffect(() => {
    refreshChats()
  }, [turns.length, refreshChats])

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

  if (!selectedChatId) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <h2 className="text-xl font-semibold text-ink">Your NOMI workspace</h2>
        <p className="mt-2 max-w-sm text-sm text-ink-soft">Choose a chat or start a new conversation with NOMI.</p>
        <button type="button" onClick={newChat} className="mt-5 rounded-lg bg-nomi-orange px-4 py-2.5 text-sm font-medium text-white hover:bg-nomi-orange-dark">
          + New Chat
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
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
    </div>
  )
}
