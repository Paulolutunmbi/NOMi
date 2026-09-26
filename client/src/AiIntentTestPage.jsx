// TEMPORARY DEVELOPMENT-ONLY HARNESS — remove after manual AI action testing.
import { useCallback, useEffect, useState } from 'react'
import { getCurrentIdToken, observeAuthState } from './services/auth'
import './AiIntentTestPage.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'
const AI_EXECUTE_URL = `${API_BASE_URL}/api/ai/execute`
const defaultMessage = 'Find my unread emails from the last 7 days.'
const sensitiveKey = /token|secret|credential|password|authorization|api.?key|placeholder.?mapping|refresh|mime|raw/i

const sanitizeValue = (value) => {
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !sensitiveKey.test(key))
        .map(([key, item]) => [key, sanitizeValue(item)]),
    )
  }
  return value
}

const getSafeError = (data) => {
  if (data?.outcome?.reason) {
    return {
      code: 'ACTION_REJECTED',
      message: `Action rejected: ${data.outcome.reason}`,
    }
  }

  const error = data?.error
  if (error && typeof error === 'object') {
    return {
      code: typeof error.code === 'string' ? error.code : 'REQUEST_FAILED',
      message: typeof error.message === 'string' ? error.message : 'The request failed.',
    }
  }

  return {
    code: 'REQUEST_FAILED',
    message: typeof data?.message === 'string' ? data.message : 'The request failed.',
  }
}

const humanizeAction = (action) => ({
  'gmail.search': 'Search Gmail',
  'gmail.read': 'Read Gmail messages',
  'gmail.draft': 'Create Gmail drafts',
  'gmail.send': 'Send Gmail messages',
  'gmail.draft.reply': 'Create Gmail reply drafts',
  'gmail.send.reply': 'Send Gmail replies',
  'gmail.search_then_reply': 'Search Gmail and draft a reply',
  'gmail.search_then_draft_reply': 'Search Gmail and draft a reply',
  'gmail.search_then_send_reply': 'Search Gmail and send a reply',
  'calendar.create': 'Create calendar events',
  'calendar.delete': 'Delete calendar events',
  'meet.create': 'Create Google Meet meetings',
}[action] || action)

function AiIntentTestPage() {
  const [signedIn, setSignedIn] = useState(false)
  const [conversationId, setConversationId] = useState('manual-test-001')
  const [message, setMessage] = useState(defaultMessage)
  const [result, setResult] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [permissions, setPermissions] = useState([])
  const [permissionMessage, setPermissionMessage] = useState('')

  const loadPermissions = useCallback(async () => {
    const token = await getCurrentIdToken()
    if (!token) return setPermissions([])
    const response = await fetch(`${API_BASE_URL}/api/permissions`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error('Unable to load permissions.')
    setPermissions(Array.isArray(data.permissions) ? data.permissions : [])
  }, [])

  useEffect(() => observeAuthState((user) => {
    setSignedIn(Boolean(user))
    if (!user) {
      setPermissions([])
      return
    }
    loadPermissions().catch(() => setPermissionMessage('Unable to load saved permissions.'))
  }), [loadPermissions])

  const executeAiAction = async (approval = undefined, messageOverride = undefined) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setResult(null)

    try {
      const token = await getCurrentIdToken()
      if (!token) {
        setResult({
          status: 401,
          success: false,
          executionType: 'error',
          errorType: 'Authentication failed',
          error: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed. Sign in to NOMI and try again.' },
          rawResponse: null,
        })
        return
      }

      const activeMessage = messageOverride !== undefined ? messageOverride : message
      const requestBody = {
        conversationId,
        message: activeMessage,
        ...(approval ? { approval } : {}),
      }

      const response = await fetch(AI_EXECUTE_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      const data = await response.json().catch(() => ({}))
      const safeData = sanitizeValue(data)

      if (response.ok) {
        const outcome = safeData?.outcome
        if (outcome?.status === 'success') {
          setResult({
            status: response.status,
            success: true,
            executionType: 'success',
            action: outcome.action,
            result: outcome.result,
            rawResponse: safeData,
          })
          loadPermissions().catch(() => setPermissionMessage('Action completed, but saved permissions could not be refreshed.'))
          return
        }

        if (outcome?.status === 'approval_required') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'approval_required',
            action: outcome.action,
            pendingAction: outcome.pendingAction || null,
            approvalMessage: `NOMI is asking to ${humanizeAction(outcome.action)}. This approval applies only to ${outcome.action}.`,
            rawResponse: safeData,
          })
          return
        }

        if (outcome?.status === 'denied') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'denied',
            action: outcome.action,
            message: `Action "${outcome.action}" was denied.`,
            rawResponse: safeData,
          })
          return
        }

        if (outcome?.status === 'ambiguous_identity') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'ambiguous_identity',
            candidates: outcome.candidates,
            message: 'Multiple matching identities found. Tap one to select:',
            rawResponse: safeData,
          })
          return
        }

        if (outcome?.status === 'ambiguous_message') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'ambiguous_message',
            candidates: outcome.candidates,
            message: 'Multiple matching conversations found. Tap one to reply to:',
            rawResponse: safeData,
          })
          return
        }

        if (outcome?.status === 'clarification') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'clarification',
            action: 'clarification',
            message: outcome.message || outcome.prompt || 'Clarification needed.',
            rawResponse: safeData,
          })
          return
        }

        if (outcome?.status === 'not_found') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'not_found',
            action: outcome.action,
            message: outcome.message || 'No matching emails were found.',
            rawResponse: safeData,
          })
          return
        }

        if (outcome?.status === 'invalid') {
          setResult({
            status: response.status,
            success: false,
            executionType: 'invalid',
            reason: outcome.reason,
            error: { code: 'INVALID_PROPOSAL', message: outcome.reason || 'The proposed action is invalid.' },
            rawResponse: safeData,
          })
          return
        }

        setResult({
          status: response.status,
          success: Boolean(safeData?.success),
          executionType: outcome?.status || 'unknown',
          rawResponse: safeData,
        })
        return
      }

      const error = getSafeError(safeData)
      const errorType = response.status === 401
        ? 'Authentication failed'
        : response.status === 422
          ? 'Validation or rejection error'
          : response.status === 503
            ? 'Provider error'
            : response.status === 400
              ? 'Bad request'
              : 'Request failed'

      setResult({
        status: response.status,
        success: false,
        executionType: 'error',
        errorType,
        error,
        rawResponse: safeData,
      })
    } catch {
      setResult({
        status: null,
        success: false,
        executionType: 'error',
        errorType: 'Request failed',
        error: { code: 'NETWORK_ERROR', message: 'Unable to reach the local API server.' },
        rawResponse: null,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const decidePendingSend = async (decision) => {
    if (!result?.pendingAction?.id || isSubmitting) return
    setIsSubmitting(true)
    try {
      const token = await getCurrentIdToken()
      const response = await fetch(`${API_BASE_URL}/api/ai/send-approval`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: result.pendingAction.id, conversationId, decision }),
      })
      const data = await response.json().catch(() => ({}))
      setResult({ status: response.status, success: Boolean(data.success), executionType: data.outcome?.status || 'error', action: result.action, result: data.outcome?.result, rawResponse: sanitizeValue(data) })
    } catch {
      setResult({ status: 500, success: false, executionType: 'error', error: { message: 'Unable to submit this send decision.' } })
    } finally { setIsSubmitting(false) }
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    executeAiAction()
  }

  const revokePermission = async ({ provider, action }) => {
    if (isSubmitting) return
    setIsSubmitting(true)
    setPermissionMessage('')
    try {
      const token = await getCurrentIdToken()
      const response = await fetch(`${API_BASE_URL}/api/permissions/${encodeURIComponent(provider)}/${encodeURIComponent(action)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('Unable to revoke permission.')
      await loadPermissions()
      setPermissionMessage(`${humanizeAction(action)} will require approval next time.`)
    } catch {
      setPermissionMessage('Unable to revoke permission.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectCandidate = (selectionId) => {
    if (!selectionId || isSubmitting) return
    const idStr = String(selectionId)
    setMessage(idStr)
    executeAiAction(undefined, idStr)
  }

  return (
    <main className="ai-intent-test-page">
      <h1>AI execution test harness</h1>
      <p className="ai-intent-test-warning">Temporary development-only page for manual AI action execution testing.</p>
      <p>This page submits requests to /api/ai/execute to test end-to-end execution and approval flows.</p>

      {!signedIn && <p className="ai-intent-test-alert" role="status">Sign in to NOMI before submitting a test request.</p>}

      <form onSubmit={handleSubmit}>
        <label htmlFor="conversation-id">Conversation ID</label>
        <input
          id="conversation-id"
          value={conversationId}
          onChange={(event) => setConversationId(event.target.value)}
          maxLength="128"
          pattern="[A-Za-z0-9_-]+"
          required
        />

        <label htmlFor="intent-message">Message</label>
        <textarea
          id="intent-message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength="4000"
          required
          rows="5"
        />

        <button type="submit" disabled={!signedIn || isSubmitting}>
          {isSubmitting ? 'Executing…' : 'Execute /api/ai/execute'}
        </button>
      </form>

      {result && (
        <section className="ai-intent-test-result" aria-live="polite">
          <h2>Response</h2>
          <p>HTTP status: {result.status ?? 'No response'}</p>
          <p>Result: {result.success ? 'Success' : 'Failure'}</p>

          {result.executionType === 'success' && (
            <div>
              <h3>Execution result ({result.action})</h3>
              <pre>{JSON.stringify(result.result, null, 2)}</pre>
            </div>
          )}

          {result.executionType === 'approval_required' && (
            <div className="ai-intent-test-alert" role="alert" style={{ marginTop: '12px' }}>
              <h3>Approval required</h3>
              <p>{result.approvalMessage}</p>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => result.pendingAction ? decidePendingSend('allow') : executeAiAction('allow_once')}
                >
                  {isSubmitting ? 'Submitting…' : 'Allow'}
                </button>
                {!result.pendingAction && <button type="button" disabled={isSubmitting} onClick={() => executeAiAction('always_allow')}>Always allow</button>}
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => result.pendingAction ? decidePendingSend('deny') : executeAiAction('deny')}
                >
                  {isSubmitting ? 'Submitting…' : 'Deny'}
                </button>
              </div>
            </div>
          )}

          {result.executionType === 'denied' && (
            <div className="ai-intent-test-alert" role="status" style={{ marginTop: '12px' }}>
              <h3>Action denied</h3>
              <p>{result.message}</p>
            </div>
          )}

          {result.executionType === 'clarification' && (
            <div className="ai-intent-test-alert" role="status" style={{ marginTop: '12px' }}>
              <h3>Clarification needed</h3>
              <p>{result.message}</p>
            </div>
          )}

          {result.executionType === 'not_found' && (
            <div className="ai-intent-test-alert" role="status" style={{ marginTop: '12px' }}>
              <h3>No matching emails found</h3>
              <p>{result.message}</p>
            </div>
          )}

          {(result.executionType === 'ambiguous_identity' || result.executionType === 'ambiguous_message') && (
            <div className="ai-intent-test-alert" role="status" style={{ marginTop: '12px' }}>
              <h3>{result.executionType === 'ambiguous_message' ? 'Which conversation?' : 'Which person do you mean?'}</h3>
              <p>{result.message}</p>
              <div
                role="list"
                aria-label={result.executionType === 'ambiguous_message' ? 'Conversation candidates' : 'Identity candidates'}
                style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}
              >
                {Array.isArray(result.candidates) && result.candidates.map((candidate) => (
                  <button
                    key={candidate.selectionId || candidate.email || candidate.name}
                    role="listitem"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => selectCandidate(candidate.selectionId)}
                    style={{
                      textAlign: 'left',
                      padding: '14px 16px',
                      border: '1px solid #c9c9c9',
                      borderRadius: '8px',
                      background: isSubmitting ? '#f3f3f3' : '#ffffff',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSubmitting) {
                        e.currentTarget.style.borderColor = '#4f46e5'
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(79, 70, 229, 0.15)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#c9c9c9'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'start' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {result.executionType === 'ambiguous_message' && (
                          <div style={{ fontWeight: 600, color: '#111827', fontSize: '15px' }}>
                            {candidate.subject || 'No subject'}
                          </div>
                        )}
                        <div style={{ marginTop: '4px', color: '#4b5563', fontSize: '13px' }}>
                          {candidate.name
                            ? (candidate.email ? `${candidate.name} <${candidate.email}>` : candidate.name)
                            : candidate.email || 'Unknown sender'}
                        </div>
                        {candidate.date && (
                          <div style={{ marginTop: '2px', color: '#6b7280', fontSize: '12px' }}>
                            {candidate.date}
                          </div>
                        )}
                        {candidate.snippet && (
                          <div style={{
                            marginTop: '6px', color: '#6b7280', fontSize: '12px',
                            overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
                            WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                          }}>
                            {candidate.snippet}
                          </div>
                        )}
                      </div>
                      <div style={{
                        flexShrink: 0, fontSize: '12px', color: '#4f46e5', fontWeight: 600,
                        padding: '4px 8px', borderRadius: '999px', background: '#eef2ff',
                      }}>
                        #{candidate.selectionId}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <p style={{ marginTop: '12px', color: '#6b7280', fontSize: '12px' }}>
                Or reply with the number (e.g. "{result.candidates?.[0]?.selectionId || '1'}") in the message box above.
              </p>
            </div>
          )}

          {result.executionType === 'error' && (
            <div>
              <h3>Safe error response</h3>
              <p>{result.errorType}</p>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </div>
          )}

          <details style={{ marginTop: '16px' }} open>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Raw response (Debug)</summary>
            <pre>{JSON.stringify(result.rawResponse, null, 2)}</pre>
          </details>
        </section>
      )}
      {signedIn && (
        <section className="ai-intent-test-permissions" aria-label="Permissions settings">
          <h2>Permissions</h2>
          <p>Always-allowed capabilities are specific to the action shown. Removing one does not disconnect Google or affect other permissions.</p>
          {permissionMessage && <p role="status">{permissionMessage}</p>}
          {permissions.length === 0 ? <p>No always-allowed permissions.</p> : (
            <ul>
              {permissions.map((permission) => (
                <li key={`${permission.provider}:${permission.action}`}>
                  <span>{humanizeAction(permission.action)} <small>({permission.action}) — always allowed</small></span>
                  <button type="button" disabled={isSubmitting} onClick={() => revokePermission(permission)}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}

export default AiIntentTestPage
