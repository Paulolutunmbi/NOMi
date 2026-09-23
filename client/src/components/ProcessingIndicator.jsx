export default function ProcessingIndicator({ label = 'NOMI is working…' }) {
  return (
    <div className="nomi-enter flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-card">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-nomi-orange"
            style={{ animation: 'nomi-pulse-dot 1.1s ease-in-out infinite', animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
      <span className="text-sm text-ink-soft" role="status" aria-live="polite">{label}</span>
    </div>
  )
}
