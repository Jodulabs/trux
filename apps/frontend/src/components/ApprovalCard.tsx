import type { ApprovalDecision, ApprovalRequestEvent } from '@trux/protocol'
import { toolSummary } from '@trux/client/tools'

interface Props {
  event: ApprovalRequestEvent
  decision?: ApprovalDecision
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  pinned?: boolean
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// One labelled action button. Lit (copper) when chosen; dimmed when a sibling was
// chosen, so the resolved card reads as decision history.
function Btn({
  testid,
  label,
  decision,
  chosen,
  onRespond,
  requestId,
  primary,
}: {
  testid: string
  label: string
  decision: ApprovalDecision
  chosen: ApprovalDecision | undefined
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  requestId: string
  primary?: boolean
}): React.ReactElement {
  const decided = chosen !== undefined
  const isChosen = chosen === decision
  return (
    <button
      data-testid={testid}
      className={`approve-btn${primary ? ' primary' : ''}${decided ? (isChosen ? ' chosen' : ' dimmed') : ''}`}
      disabled={decided}
      onClick={() => onRespond(requestId, decision)}
    >
      {label}
    </button>
  )
}

// A structured, one-thumb approval. The one thing being approved (command / path)
// is shown in copper mono; the raw input is tucked into an expandable section so a
// blocking decision never makes you read JSON. Graduated trust buttons let you
// widen the grant by tool family without going full-yolo.
export function ApprovalCard({ event, decision, onRespond, pinned }: Props): React.ReactElement {
  const summary = toolSummary(event.tool, event.input)
  const isEdit = EDIT_TOOLS.has(event.tool)
  const isBash = event.tool === 'Bash'

  return (
    <div className={`approval-card${pinned ? ' pinned' : ''}`} data-testid={pinned ? 'approval-pinned' : 'approval-card'}>
      <strong>Approve <span className="tool-name">{event.tool}</span>?</strong>
      {event.explanation ? <p className="approval-why">{event.explanation}</p> : null}
      {summary ? <div className="approval-subject" data-testid="approval-subject">{summary}</div> : null}
      <details className="approval-raw">
        <summary>raw input</summary>
        <pre>{JSON.stringify(event.input, null, 2)}</pre>
      </details>
      {decision ? (
        <p data-testid="approval-decided">You chose: {decision}</p>
      ) : null}
      <div className="approval-actions">
        <Btn testid="approve-allow" label={isEdit || isBash ? 'Allow once' : 'Allow'} decision="allow" primary chosen={decision} onRespond={onRespond} requestId={event.request_id} />
        {isEdit ? (
          <Btn testid="approve-edits" label="Allow all edits" decision="allow_edits" chosen={decision} onRespond={onRespond} requestId={event.request_id} />
        ) : null}
        {isBash ? (
          <Btn testid="approve-command" label="Allow this command" decision="allow_command" chosen={decision} onRespond={onRespond} requestId={event.request_id} />
        ) : null}
        {!isEdit && !isBash ? (
          <Btn testid="approve-always" label="Always" decision="allow_always" chosen={decision} onRespond={onRespond} requestId={event.request_id} />
        ) : null}
        <Btn testid="approve-deny" label="Deny" decision="deny" chosen={decision} onRespond={onRespond} requestId={event.request_id} />
      </div>
    </div>
  )
}
