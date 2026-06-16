import type { ApprovalDecision } from '@trux/protocol'
import type { TranscriptItem } from '../store'
import { ApprovalCard } from './ApprovalCard'

interface Props {
  items: TranscriptItem[]
  approvalDecisions: Record<string, ApprovalDecision>
  onRespond: (requestId: string, decision: ApprovalDecision) => void
}

export function Transcript({ items, approvalDecisions, onRespond }: Props): React.ReactElement {
  return (
    <div data-testid="transcript">
      {items.map((item, i) => {
        if (item.type === 'user_text') return <p key={i} className="msg user">{item.text}</p>
        if (item.type === 'text') return <p key={i} className="msg assistant">{item.text}</p>
        if (item.type === 'approval_request')
          return (
            <ApprovalCard
              key={i}
              event={item}
              decision={approvalDecisions[item.request_id]}
              onRespond={onRespond}
            />
          )
        if (item.type === 'tool_call')
          return (
            <details key={i} className="tool">
              <summary>🔧 {item.name}</summary>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
            </details>
          )
        return (
          <details key={i} className={`tool ${item.status}`}>
            <summary>← {item.status}</summary>
            {item.output ? <pre>{item.output}</pre> : null}
            {item.images?.map((img, j) => (
              <img
                key={j}
                data-testid="tool-image"
                className="tool-image"
                src={`data:${img.media_type};base64,${img.data}`}
                alt="tool output"
              />
            ))}
          </details>
        )
      })}
    </div>
  )
}
