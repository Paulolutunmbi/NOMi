const COPY = {
  network: {
    title: "You're offline",
    body: "Check your internet connection and try again.",
  },
  auth: {
    title: 'Your Google connection needs to be restored',
    body: 'Reconnect Google so NOMI can keep working on your behalf.',
    cta: 'Reconnect Google',
  },
  server: {
    title: 'Something went wrong on our side',
    body: 'NOMI ran into a problem handling that. Give it another try.',
  },
  timeout: {
    title: 'NOMI took too long to respond',
    body: 'The request timed out. Try again in a moment.',
  },
  rejected: {
    title: "NOMI couldn't do that safely",
    body: 'Try rephrasing your request.',
  },
}

export default function ErrorState({ kind = 'server', onRetry, onReconnect }) {
  const copy = COPY[kind] || COPY.server
  const isAuth = kind === 'auth'
  return (
    <div className="nomi-enter flex items-start gap-3 rounded-xl border border-danger/30 bg-danger-tint p-3.5">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0 text-danger" aria-hidden="true">
        <path d="M12 9v4m0 4h.01M10.3 3.9 2.5 17a1.8 1.8 0 0 0 1.55 2.7h15.9A1.8 1.8 0 0 0 21.5 17L13.7 3.9a1.8 1.8 0 0 0-3.1 0Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="flex-1">
        <p className="text-sm font-medium text-ink">{copy.title}</p>
        <p className="mt-0.5 text-xs text-ink-soft">{copy.body}</p>
        <button
          type="button"
          onClick={isAuth ? onReconnect : onRetry}
          className="mt-2.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-ink-soft"
        >
          {isAuth ? 'Reconnect Google' : 'Try again'}
        </button>
      </div>
    </div>
  )
}
