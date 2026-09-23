import { useNetworkStatus } from '../hooks/useNetworkStatus'

export default function NetworkBanner() {
  const { online, justReconnected } = useNetworkStatus()

  if (online && !justReconnected) return null

  return (
    <div
      role="status"
      className={`nomi-enter flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium ${
        online ? 'bg-success-tint text-success' : 'bg-warning-tint text-warning'
      }`}
    >
      {online ? "You're back online." : "You're offline. Some NOMI actions may be unavailable."}
    </div>
  )
}
