// TEMPORARY DEVELOPMENT-ONLY HARNESS — remove after manual AI intent testing.
import { useEffect, useState } from 'react'
import { getCurrentIdToken, observeAuthState } from './services/auth'
import './AiIntentTestPage.css'

const AI_INTENT_URL = 'http://localhost:5000/api/ai/intent'
const defaultMessage = 'Find my unread emails from the last 7 days.'
const sensitiveKey = /token|secret|credential|password|authorization|api.?key|placeholder.?mapping/i

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

function AiIntentTestPage() {
  const [signedIn, setSignedIn] = useState(false)
  const [conversationId, setConversationId] = useState('manual-test-001')
  const [message, setMessage] = useState(defaultMessage)
  const [result, setResult] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => observeAuthState((user) => setSignedIn(Boolean(user))), [])

  const submitIntent = async (event) => {
    event.preventDefault()
    setIsSubmitting(true)
    setResult(null)

    try {
      const token = await getCurrentIdToken()
      if (!token) {
        setResult({ status: 401, success: false, errorType: 'Authentication failed', error: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed. Sign in to NOMI and try again.' } })
        return
      }

      const response = await fetch(AI_INTENT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conversationId, message }),
      })
      const data = await response.json().catch(() => ({}))

      if (response.ok) {
        setResult({ status: response.status, success: true, intent: sanitizeValue(data.intent) })
        return
      }

      const error = getSafeError(data)
      const errorType = response.status === 401
        ? 'Authentication failed'
        : response.status === 422
          ? 'Validation error'
          : response.status === 503
            ? 'Provider error'
            : 'Request failed'
      setResult({ status: response.status, success: false, errorType, error })
    } catch {
      setResult({ status: null, success: false, errorType: 'Request failed', error: { code: 'NETWORK_ERROR', message: 'Unable to reach the local API server.' } })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="ai-intent-test-page">
      <h1>AI intent test harness</h1>
      <p className="ai-intent-test-warning">Temporary development-only page. Remove after manual testing.</p>
      <p>This page only submits an intent request. It does not execute Gmail actions.</p>

      {!signedIn && <p className="ai-intent-test-alert" role="status">Sign in to NOMI before submitting a test request.</p>}

      <form onSubmit={submitIntent}>
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
          {isSubmitting ? 'Submitting…' : 'Test /api/ai/intent'}
        </button>
      </form>

      {result && (
        <section className="ai-intent-test-result" aria-live="polite">
          <h2>Response</h2>
          <p>HTTP status: {result.status ?? 'No response'}</p>
          <p>Result: {result.success ? 'Success' : 'Failure'}</p>
          {result.success ? (
            <>
              <h3>Returned intent</h3>
              <pre>{JSON.stringify(result.intent, null, 2)}</pre>
            </>
          ) : (
            <>
              <h3>Safe error response</h3>
              <p>{result.errorType}</p>
              <pre>{JSON.stringify(result.error, null, 2)}</pre>
            </>
          )}
        </section>
      )}
    </main>
  )
}

export default AiIntentTestPage
