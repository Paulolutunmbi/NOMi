import { useCallback, useRef, useState } from 'react'
import { executeAiAction, NomiApiError, NomiNetworkError } from '../api/nomiClient'

let turnCounter = 0
const nextId = () => `t${++turnCounter}-${Date.now()}`

// Maps a raw outcome/error into the shape the transcript renders.
// Nothing here fabricates content the backend didn't actually send —
// see NomiCard's draft-related components for why.
function turnFromOutcome(outcome) {
  switch (outcome.status) {
    case 'success':
      return { kind: 'success', action: outcome.action, result: outcome.result }
    case 'approval_required':
      return { kind: 'approval_required', action: outcome.action }
    case 'denied':
      return { kind: 'denied', action: outcome.action }
    case 'ambiguous_identity':
      return { kind: 'ambiguous_identity', action: outcome.action, candidates: outcome.candidates || [] }
    case 'ambiguous_message':
      return { kind: 'ambiguous_message', action: outcome.action, candidates: outcome.candidates || [] }
    case 'clarification':
      return { kind: 'clarification', message: outcome.message || 'Could you say a bit more about what you\'d like NOMI to do?' }
    case 'not_found':
      return { kind: 'not_found', message: outcome.message || 'No matching results found.' }
    case 'invalid':
    case 'rejected':
      return { kind: 'clarification', message: 'NOMI couldn\'t safely carry out that request. Try rephrasing it.' }
    default:
      return { kind: 'clarification', message: 'NOMI isn\'t sure how to help with that yet.' }
  }
}

function turnFromError(error) {
  if (error instanceof NomiNetworkError) {
    return { kind: 'error', errorKind: 'network' }
  }
  if (error instanceof NomiApiError) {
    if (error.status === 401) return { kind: 'error', errorKind: 'auth' }
    if (error.status === 503) return { kind: 'error', errorKind: 'server' }
    if (error.status === 422) return { kind: 'error', errorKind: 'rejected' }
    if (error.status === 408 || error.status === 504) return { kind: 'error', errorKind: 'timeout' }
    return { kind: 'error', errorKind: 'server' }
  }
  return { kind: 'error', errorKind: 'server' }
}

/**
 * Drives one scoped conversation (Home / Gmail / Calendar each keep their
 * own conversationId so they don't bleed into each other's context) through
 * the single /api/ai/execute contract.
 */
export function useNomiConversation(conversationId) {
  const [turns, setTurns] = useState([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('NOMI is working…')
  const lastMessageRef = useRef('')
  const abortRef = useRef(null)

  const runExecute = useCallback(async ({ message, approval, label }) => {
    setIsProcessing(true)
    setProcessingLabel(label || 'NOMI is working…')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const data = await executeAiAction({ conversationId, message, approval, signal: controller.signal })
      const turn = { id: nextId(), role: 'nomi', ...turnFromOutcome(data.outcome) }
      setTurns((prev) => [...prev, turn])
      return turn
    } catch (error) {
      if (error?.name === 'AbortError') return null
      const turn = { id: nextId(), role: 'nomi', ...turnFromError(error) }
      setTurns((prev) => [...prev, turn])
      return turn
    } finally {
      setIsProcessing(false)
    }
  }, [conversationId])

  const send = useCallback((message) => {
    const trimmed = message.trim()
    if (!trimmed) return
    lastMessageRef.current = trimmed
    setTurns((prev) => [...prev, { id: nextId(), role: 'user', kind: 'text', message: trimmed }])
    return runExecute({ message: trimmed, label: labelFor(trimmed) })
  }, [runExecute])

  // Tapping an identity/conversation/calendar candidate card.
  const selectCandidate = useCallback((selectionId) => {
    if (!selectionId) return
    lastMessageRef.current = String(selectionId)
    return runExecute({ message: String(selectionId), label: 'Looking through the matches…' })
  }, [runExecute])

  // Responding to an approval_required card.
  const respondApproval = useCallback((approval) => {
    const message = lastMessageRef.current || 'continue'
    const label = approval === 'deny' ? 'Cancelling…' : 'Finishing that up…'
    return runExecute({ message, approval, label })
  }, [runExecute])

  const retryLast = useCallback(() => {
    if (!lastMessageRef.current) return
    return runExecute({ message: lastMessageRef.current, label: 'Trying again…' })
  }, [runExecute])

  return { turns, isProcessing, processingLabel, send, selectCandidate, respondApproval, retryLast }
}

function labelFor(message) {
  const lower = message.toLowerCase()
  if (/calendar|meeting|event|schedule/.test(lower)) return 'Checking your calendar…'
  if (/reply|respond/.test(lower)) return 'Preparing your reply…'
  if (/draft|write|compose/.test(lower)) return 'Preparing your draft…'
  if (/find|search|look/.test(lower)) return 'Looking through your messages…'
  return 'NOMI is working…'
}
