import { NomiMark } from './NomiLogo'

export default function EmptyState({ title, body, suggestions = [], onSuggestion }) {
  return (
    <div className="nomi-enter flex h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <NomiMark size={40} />
      <div>
        <p className="text-base font-semibold text-ink">{title}</p>
        <p className="mt-1.5 max-w-sm text-sm text-ink-faint">{body}</p>
      </div>
      {suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggestion(s)}
              className="rounded-full border border-line px-3.5 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-nomi-orange hover:text-nomi-orange-dark"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
