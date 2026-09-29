import { getCurrentIdToken } from '../services/auth'

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

// Thrown when the request never reached the server (offline / DNS / CORS).
export class NomiNetworkError extends Error {
  constructor() {
    super('NOMI_NETWORK_ERROR')
    this.name = 'NomiNetworkError'
  }
}

// Thrown for any non-2xx response the server actually returned.
// Carries the HTTP status and the server's { code, message } when present,
// so the UI can pick the right error state without ever showing raw
// backend payloads to the user.
export class NomiApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message || 'NOMI_API_ERROR')
    this.name = 'NomiApiError'
    this.status = status
    this.code = code || 'UNKNOWN'
    this.details = details
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const token = await getCurrentIdToken()
  if (!token) {
    throw new NomiApiError(401, 'AUTHENTICATION_FAILED', 'Sign in to NOMI first.')
  }

  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new NomiNetworkError()
  }

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const errorPayload = data?.error
    const outcome = data?.outcome
    const code = errorPayload?.code || (outcome?.status === 'rejected' ? 'ACTION_REJECTED' : undefined)
    const details = errorPayload || outcome || null
    if (import.meta.env.DEV) {
      console.warn(`[NOMI API] ${method} ${path} returned ${response.status}`, { code, details })
    }
    throw new NomiApiError(
      response.status,
      code,
      errorPayload?.message || data?.message || (outcome?.status === 'rejected' ? 'NOMI rejected this action.' : undefined),
      details,
    )
  }

  return data
}

/**
 * The single endpoint that drives every Gmail and Calendar workflow.
 * `approval` is only sent once NOMI has asked for one:
 * 'allow_once' | 'always_allow' | 'deny'.
 * `attachmentIds` are ids returned by uploadAttachment(), for a draft/send
 * that should include one or more images.
 */
export function executeAiAction({ conversationId, message, approval, attachmentIds, signal }) {
  return request('/api/ai/execute', {
    method: 'POST',
    body: {
      conversationId,
      message,
      ...(approval ? { approval } : {}),
      ...(attachmentIds?.length ? { attachmentIds } : {}),
    },
    signal,
  })
}

export function decideSendApproval({ actionId, conversationId, decision, signal }) {
  return request('/api/ai/send-approval', { method: 'POST', body: { actionId, conversationId, decision }, signal })
}

export function updateSendDraft({ actionId, conversationId, recipient, subject, body, signal }) {
  return request(`/api/ai/send-approval/${encodeURIComponent(actionId)}`, { method: 'PATCH', body: { conversationId, recipient, subject, body }, signal })
}

export function getOrCreateChat(type) {
  return request('/api/chats', { method: 'POST', body: { type } })
}

export function createChat(type) {
  return request('/api/chats', { method: 'POST', body: { type } })
}

export function listChats(type) {
  return request(`/api/chats?type=${encodeURIComponent(type)}`)
}

// All of the user's Gmail + Calendar (+ any other) chats, newest activity
// first — used to aggregate "Recent conversations" on the Home page.
export function listAllChats() {
  return request('/api/chats')
}

export function fetchChat(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}`)
}

export function fetchChatMessages(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/messages`)
}

export function saveChatMessage(chatId, { role, content, metadata }) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: { role, content, metadata } })
}

export function deleteChat(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' })
}

/**
 * Uploads one image (as a data: URL string from FileReader) for staging.
 * Returns { id, filename, mimeType, size } — never the raw bytes back.
 */
export function uploadAttachment({ filename, mimeType, data, chatId, signal }) {
  return request('/api/attachments/upload', {
    method: 'POST',
    body: { filename, mimeType, data, ...(chatId ? { chatId } : {}) },
    signal,
  })
}

export function deleteAttachment(attachmentId) {
  return request(`/api/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' })
}

export function fetchPermissions() {
  return request('/api/permissions')
}

export function revokePermission({ provider, action }) {
  return request(`/api/permissions/${encodeURIComponent(provider)}/${encodeURIComponent(action)}`, {
    method: 'DELETE',
  })
}

export function fetchGoogleStatus() {
  return request('/api/integrations/google/status')
}

export async function getGoogleConnectUrl() {
  const data = await request('/api/integrations/google/connect?mode=json')
  return data.authorizationUrl
}

export function disconnectGoogle() {
  return request('/api/integrations/google', { method: 'DELETE' })
}

export function fetchMe() {
  return request('/api/auth/me')
}

// Sets or changes the country NOMI uses to default this user's calendar
// events to a time zone (and, going forward, their mail time zone too).
export function updateCountry(country) {
  return request('/api/auth/me/country', { method: 'PATCH', body: { country } })
}

// Public check used on the sign-up form, before there is a token: is this a
// country NOMI can map to a time zone? Resolves true/false; a network failure
// resolves true so an outage never blocks sign-up (Onboarding asks again).
export async function isCountryRecognized(country) {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/country/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country }),
    })
    if (response.status === 400) return false
    return true
  } catch {
    return true
  }
}

export function logoutNomi() {
  return request('/api/auth/logout', { method: 'POST' })
}
