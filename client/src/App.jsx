import { useEffect, useState } from 'react'
import { getCurrentIdToken, observeAuthState } from './services/auth'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

function App() {
  const [signedIn, setSignedIn] = useState(false)
  const [connection, setConnection] = useState(null)
  const [message, setMessage] = useState('')

  const callApi = async (path, options = {}) => {
    const token = await getCurrentIdToken()
    if (!token) throw new Error('Sign in to NOMI before connecting Google.')
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'Google connection request failed.')
    return data
  }

  const loadStatus = async () => {
    try {
      const data = await callApi('/api/integrations/google/status')
      setConnection(data)
    } catch (error) {
      setMessage(error.message)
    }
  }

  useEffect(() => observeAuthState((user) => {
    setSignedIn(Boolean(user))
    if (!user) {
      setConnection(null)
      return
    }
    ;(async () => {
      try {
        const token = await user.getIdToken()
        const response = await fetch(`${API_BASE_URL}/api/integrations/google/status`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.message || 'Unable to check Google connection.')
        setConnection(data)
      } catch (error) {
        setMessage(error.message)
      }
    })()
  }), [])

  const connectGoogle = async () => {
    try {
      const data = await callApi('/api/integrations/google/connect?mode=json')
      window.location.assign(data.authorizationUrl)
    } catch (error) {
      setMessage(error.message)
    }
  }

  const disconnectGoogle = async () => {
    try {
      await callApi('/api/integrations/google', { method: 'DELETE' })
      await loadStatus()
      setMessage('Google account disconnected.')
    } catch (error) {
      setMessage(error.message)
    }
  }

  return (
    <main>
      <h1>NOMI</h1>
      <p>Application setup in progress.</p>
      <section aria-label="Temporary Google connection test surface">
        <h2>Google connection (development)</h2>
        {!signedIn && <p>Sign in to NOMI first, then return here to connect Google.</p>}
        {signedIn && connection?.connected && (
          <>
            <p>Connected as {connection.account.email} ({connection.account.status}).</p>
            <button type="button" onClick={disconnectGoogle}>Disconnect Google</button>
          </>
        )}
        {signedIn && !connection?.connected && <button type="button" onClick={connectGoogle}>Connect Google</button>}
        {message && <p role="status">{message}</p>}
      </section>
    </main>
  )
}

export default App
