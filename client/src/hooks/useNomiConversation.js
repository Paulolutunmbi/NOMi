import { useCallback, useEffect, useRef, useState } from 'react'
import { executeAiAction, decideSendApproval, updateSendDraft, fetchChatMessages, fetchChat, saveChatMessage } from '../api/nomiClient'
import { errorKindFor } from '../utils/errorKind'

let turnCounter = 0
const nextId = () => `t${++turnCounter}-${Date.now()}`

// Draft/send actions are the only ones where an attached file is relevant.
const CARRIES_ATTACHMENTS = /^gmail\.(draft|send)(\.|$)/

// Maps a raw outcome/error into the shape the transcript renders.
// Nothing here fabricates content the backend didn't actually send —
// see WorkspaceCards' draft-related components for why.
function turnFromOutcome(outcome, attachmentsMeta) {
  switch (outcome.status) {
    case 'success': {
      const turn = { kind: 'success', action: outcome.action, result: outcome.result, selectedIdentity: outcome.selectedIdentity || null, selectedConversation: outcome.selectedConversation || null }
      // We know what *we* sent with this request, and a success status
      // confirms the backend processed the whole request — attachments
      // included. This never claims content the backend didn't confirm.
      if (attachmentsMeta?.length && CARRIES_ATTACHMENTS.test(outcome.action || '')) {
        turn.attachmentsMeta = attachmentsMeta
      }
      return turn
    }
    case 'approval_required':
      return { kind: 'approval_required', action: outcome.action, pendingAction: outcome.pendingAction || null, selectedIdentity: outcome.selectedIdentity || null, selectedConversation: outcome.selectedConversation || null }
    case 'denied':
      return { kind: 'denied', action: outcome.action }
    case 'ambiguous_identity':
      return { kind: 'ambiguous_identity', action: outcome.action, candidates: outcome.candidates || [], selectedIdentity: outcome.selectedIdentity || null }
    case 'ambiguous_message':
      return { kind: 'ambiguous_message', action: outcome.action, candidates: outcome.candidates || [], selectedIdentity: outcome.selectedIdentity || null }
    case 'no_previous_conversation':
      return { kind: 'no_previous_conversation', message: outcome.message, selectedIdentity: outcome.selectedIdentity || null }
    case 'clarification':
      return { kind: 'clarification', message: outcome.message || 'Could you say a bit more about what you\'d like NOMI to do?' }
    case 'chat':
      return { kind: 'chat', message: outcome.message || 'Hi! How can I help with your email or calendar today?' }
    case 'not_found':
      return { kind: 'not_found', message: outcome.message || 'No matching results found.' }
    case 'email_domain_warning': {
      const message = outcome.reason === 'likely_typo'
        ? `That email address doesn't look right — "${outcome.domain}" looks like it might be a typo of "${outcome.suggestion}". Did you mean ${outcome.correctedEmail}? Nothing was sent — try again with the corrected address.`
        : `I couldn't find a mail server for "${outcome.domain}", so that address may not be able to receive mail. Please double-check it and try again.`
      return { kind: 'clarification', message }
    }
    case 'invalid':
    case 'rejected':
      return { kind: 'clarification', message: 'NOMI couldn\'t safely carry out that request. Try rephrasing it.' }
    default:
      return { kind: 'clarification', message: 'NOMI isn\'t sure how to help with that yet.' }
  }
}

function turnFromError(error) {
  return { kind: 'error', errorKind: errorKindFor(error) }
}

/**
 * Drives one conversation through the single /api/ai/execute contract. Mail
 * and calendar actions are both available from any chat — there's no
 * per-workspace scoping anymore, just the selected chat's own history.
 */
export function useNomiConversation(selectedChatId) {
  const [turns, setTurns] = useState([])
  const [chatId, setChatId] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingLabel, setProcessingLabel] = useState('NOMI is working…')
  const lastMessageRef = useRef('')
  const lastAttachmentIdsRef = useRef([])
  const lastAttachmentsMetaRef = useRef([])
  const abortRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!selectedChatId) return
      try {
        const { chat } = await fetchChat(selectedChatId)
        const history = await fetchChatMessages(chat.id)
        if (cancelled) return
        setChatId(chat.id)
        setTurns((history.messages || []).map((item) => item.role === 'user'
          ? { id: item.id, role: 'user', kind: 'text', message: item.content, attachments: item.metadata?.attachments || [] }
          : { id: item.id, role: 'nomi', ...restoreTurn(item.metadata, item.content) }))
      } catch {
        if (!cancelled) setTurns([{ id: nextId(), role: 'nomi', kind: 'error', errorKind: 'server' }])
      }
    })()
    return () => { cancelled = true; abortRef.current?.abort() }
  }, [selectedChatId])

  const runExecute = useCallback(async ({ message, approval, label, attachmentIds, attachmentsMeta }) => {
    setIsProcessing(true)
    setProcessingLabel(label || 'NOMI is working…')
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    try {
      if (!chatId || chatId !== selectedChatId) throw new Error('Chat is still loading')
      const data = await executeAiAction({ conversationId: chatId, message, approval, attachmentIds, signal: controller.signal })
      const turn = { id: nextId(), role: 'nomi', ...turnFromOutcome(data.outcome, attachmentsMeta) }
      setTurns((prev) => [...prev, turn])
      await saveChatMessage(chatId, { role: 'assistant', content: turn.message || turn.prompt || turn.result?.message || turn.result?.body || turn.kind, metadata: { kind: turn.kind, action: turn.action, result: turn.result, candidates: turn.candidates, selectedIdentity: turn.selectedIdentity, selectedConversation: turn.selectedConversation } }).catch(() => {})
      return turn
    } catch (error) {
      if (error?.name === 'AbortError') return null
      const turn = { id: nextId(), role: 'nomi', ...turnFromError(error) }
      setTurns((prev) => [...prev, turn])
      return turn
    } finally {
      setIsProcessing(false)
    }
  }, [chatId, selectedChatId])

  const send = useCallback((message, attachmentIds = [], attachmentsMeta = []) => {
    const trimmed = message.trim()
    if (!trimmed) return
    lastMessageRef.current = trimmed
    lastAttachmentIdsRef.current = attachmentIds
    lastAttachmentsMetaRef.current = attachmentsMeta
    setTurns((prev) => [
      ...prev,
      { id: nextId(), role: 'user', kind: 'text', message: trimmed, attachments: attachmentsMeta },
    ])
    if (chatId) saveChatMessage(chatId, { role: 'user', content: trimmed, metadata: { attachments: attachmentsMeta } }).catch(() => {})
    return runExecute({ message: trimmed, label: labelFor(trimmed), attachmentIds, attachmentsMeta })
  }, [runExecute, chatId])

  // Tapping an identity/conversation/calendar candidate card.
  const selectCandidate = useCallback((selectionId) => {
    if (!selectionId) return
    lastMessageRef.current = String(selectionId)
    return runExecute({
      message: String(selectionId),
      label: 'Looking through the matches…',
      attachmentIds: lastAttachmentIdsRef.current,
      attachmentsMeta: lastAttachmentsMetaRef.current,
    })
  }, [runExecute])

  // Responding to an approval_required card.
  const respondApproval = useCallback(async (actionId, decision) => {
    if (!actionId) {
      const approval = decision === 'deny' ? 'deny' : decision === 'always_allow' ? 'always_allow' : 'allow_once'
      return runExecute({ message: lastMessageRef.current || 'continue', approval, label: decision === 'deny' ? 'Cancelling…' : 'Finishing that up…', attachmentIds: lastAttachmentIdsRef.current, attachmentsMeta: lastAttachmentsMetaRef.current })
    }
    setIsProcessing(true)
    setProcessingLabel(decision === 'deny' ? 'Denying send…' : 'Sending approved email…')
    try {
      const response = await decideSendApproval({ actionId, conversationId: chatId, decision })
      const outcome = response.outcome || {}
      const turn = { id: nextId(), role: 'nomi', ...(outcome.status === 'success'
        ? { kind: 'success', action: outcome.action || 'gmail.send', result: outcome.result || {} }
        : { kind: outcome.status === 'denied' ? 'denied' : 'error', message: outcome.status === 'denied' ? 'Send denied.' : 'The send could not be approved.', errorKind: 'generic' }) }
      setTurns((prev) => [...prev, turn])
      await saveChatMessage(chatId, { role: 'assistant', content: turn.message || (turn.kind === 'success' ? 'Email sent.' : 'Send denied.'), metadata: { kind: turn.kind, action: turn.action, result: turn.result } }).catch(() => {})
      return turn
    } catch (error) {
      const turn = { id: nextId(), role: 'nomi', ...turnFromError(error) }
      setTurns((prev) => [...prev, turn])
      return turn
    } finally { setIsProcessing(false) }
  }, [chatId, runExecute])

  const editSendDraft = useCallback(async (actionId, draft) => {
    const { outcome } = await updateSendDraft({ actionId, conversationId: chatId, ...draft })
    setTurns((prev) => prev.map((turn) => turn.pendingAction?.id === actionId ? { ...turn, pendingAction: { ...turn.pendingAction, ...outcome.pendingAction, preview: outcome.pendingAction.body } } : turn))
    return outcome.pendingAction
  }, [chatId])

  const retryLast = useCallback(() => {
    if (!lastMessageRef.current) return
    return runExecute({
      message: lastMessageRef.current,
      label: 'Trying again…',
      attachmentIds: lastAttachmentIdsRef.current,
      attachmentsMeta: lastAttachmentsMetaRef.current,
    })
  }, [runExecute])

  return { turns, isProcessing, processingLabel, send, selectCandidate, respondApproval, editSendDraft, retryLast }
}

function restoreTurn(metadata, content) {
  if (!metadata || !metadata.kind) return { kind: 'clarification', message: content }
  return { ...metadata, message: metadata.message || content }
}

function labelFor(message) {
  const lower = message.toLowerCase()
  if (/calendar|meeting|event|schedule/.test(lower)) return 'Checking your calendar…'
  if (/reply|respond/.test(lower)) return 'Preparing your reply…'
  if (/draft|write|compose/.test(lower)) return 'Preparing your draft…'
  if (/find|search|look/.test(lower)) return 'Looking through your messages…'
  return 'NOMI is working…'
}
