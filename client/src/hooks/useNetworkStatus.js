import { useEffect, useState } from 'react'

export function useNetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [justReconnected, setJustReconnected] = useState(false)

  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      setJustReconnected(true)
      const timer = setTimeout(() => setJustReconnected(false), 3000)
      return () => clearTimeout(timer)
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return { online, justReconnected }
}
