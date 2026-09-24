import {
  ApprovalCard,
  CalendarCandidates,
  ConversationCandidates,
  IdentityCandidates,
  SuccessCard,
} from './WorkspaceCards'
import ErrorState from './ErrorState'
import { formatBytes } from '../utils/attachments'

export default function ChatMessage({ turn, isLatest, onSelectCandidate, onDecideApproval, onRetry, onReconnect, busy }) {
  if (turn.role === 'user') {
    return (
      <div className="nomi-enter flex flex-col items-end gap-1.5">
        {Array.isArray(turn.attachments) && turn.attachments.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {turn.attachments.map((attachment, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink-soft"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
                  <circle cx="9" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
                {attachment.filename}
                {typeof attachment.size === 'number' ? ` · ${formatBytes(attachment.size)}` : ''}
              </span>
            ))}
          </div>
        )}
        <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-ink px-4 py-2.5 text-[15px] text-white">
          {turn.message}
        </div>
      </div>
    )
  }

  const interactive = isLatest && !busy

  return (
    <div className="nomi-enter flex justify-start">
      <div className="max-w-[85%] flex-1">
        {turn.kind === 'clarification' && (
          <p className="rounded-2xl rounded-tl-sm border border-line bg-surface px-4 py-2.5 text-[15px] text-ink-soft">{turn.message}</p>
        )}
        {turn.kind === 'not_found' && (
          <p className="rounded-2xl rounded-tl-sm border border-line bg-surface px-4 py-2.5 text-[15px] text-ink-soft">{turn.message}</p>
        )}
        {turn.kind === 'denied' && (
          <p className="rounded-2xl rounded-tl-sm border border-line bg-surface px-4 py-2.5 text-[15px] text-ink-faint">Okay, cancelled.</p>
        )}
        {turn.kind === 'ambiguous_identity' && (
          <IdentityCandidates candidates={turn.candidates} onSelect={onSelectCandidate} disabled={!interactive} />
        )}
        {turn.kind === 'ambiguous_message' && (
          <ConversationCandidates candidates={turn.candidates} onSelect={onSelectCandidate} disabled={!interactive} />
        )}
        {turn.kind === 'calendar_candidates' && (
          <CalendarCandidates candidates={turn.candidates} disabled />
        )}
        {turn.kind === 'approval_required' && (
          <ApprovalCard action={turn.action} onDecide={onDecideApproval} disabled={!interactive} />
        )}
        {turn.kind === 'success' && <SuccessCard action={turn.action} result={turn.result} attachmentsMeta={turn.attachmentsMeta} />}
        {turn.kind === 'error' && <ErrorState kind={turn.errorKind} onRetry={onRetry} onReconnect={onReconnect} />}
      </div>
    </div>
  )
}
