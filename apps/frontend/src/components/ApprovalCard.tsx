import type { ApprovalDecision, ApprovalRequestEvent } from '@trux/protocol'

interface Props {
  event: ApprovalRequestEvent
  decision?: ApprovalDecision
  onRespond: (requestId: string, decision: ApprovalDecision) => void
}

export function ApprovalCard({ event, decision, onRespond }: Props): React.ReactElement {
  return (
    <div className="approval-card" data-testid="approval-card">
      <strong>Approve {event.tool}?</strong>
      {event.explanation ? <p>{event.explanation}</p> : null}
      <pre>{JSON.stringify(event.input, null, 2)}</pre>
      {decision ? (
        <p data-testid="approval-decided">You chose: {decision}</p>
      ) : (
        <div className="approval-actions">
          <button data-testid="approve-allow" onClick={() => onRespond(event.request_id, 'allow')}>Allow</button>
          <button data-testid="approve-deny" onClick={() => onRespond(event.request_id, 'deny')}>Deny</button>
          <button data-testid="approve-always" onClick={() => onRespond(event.request_id, 'allow_always')}>Always</button>
        </div>
      )}
    </div>
  )
}
