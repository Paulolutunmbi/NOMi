import {
  ApprovalCard,
  CalendarCandidates,
  ConversationCandidates,
  IdentityCandidates,
  SuccessCard,
} from './WorkspaceCards'
import ErrorState from './ErrorState'

export default function ChatMessage({ turn, isLatest, onSelectCandidate, onDecideApproval, onRetry, onReconnect, busy }) {
  if (turn.role === 'user') {
    return (
      <div className="nomi-enter flex justify-end">
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
        {turn.kind === 'success' && <SuccessCard action={turn.action} result={turn.result} />}
        {turn.kind === 'error' && <ErrorState kind={turn.errorKind} onRetry={onRetry} onReconnect={onReconnect} />}
      </div>
    </div>
  )
}
