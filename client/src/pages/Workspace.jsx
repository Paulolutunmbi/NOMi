import { useEffect, useRef } from 'react'
import ChatMessage from '../components/ChatMessage'
import Composer from '../components/Composer'
import EmptyState from '../components/EmptyState'
import ProcessingIndicator from '../components/ProcessingIndicator'
import { useNomiConversation } from '../hooks/useNomiConversation'
import { getGoogleConnectUrl } from '../api/nomiClient'

export default function Workspace({
  conversationId,
  placeholder,
  emptyTitle,
  emptyBody,
  suggestions = [],
}) {
  const { turns, isProcessing, processingLabel, send, selectCandidate, respondApproval, retryLast } =
    useNomiConversation(conversationId)
  const scrollRef = useRef(null)

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
    <div className="flex h-full flex-col">
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
        <Composer placeholder={placeholder} disabled={isProcessing} onSend={send} />
      </div>
    </div>
  )
}
