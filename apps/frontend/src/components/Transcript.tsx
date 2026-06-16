import type { ApprovalDecision } from '@trux/protocol'
import type { TranscriptItem } from '../store'
import { ApprovalCard } from './ApprovalCard'
import { Markdown } from './Markdown'
import { toolSummary } from '../tools'

interface Props {
  items: TranscriptItem[]
  approvalDecisions: Record<string, ApprovalDecision>
  onRespond: (requestId: string, decision: ApprovalDecision) => void
}

export function Transcript({ items, approvalDecisions, onRespond }: Props): React.ReactElement {
  return (
    <div className="transcript" data-testid="transcript">
      {items.map((item, i) => {
        if (item.type === 'user_text') return <div key={i} className="msg user">{item.text}</div>
        if (item.type === 'text')
          return (
            <div key={i} className="msg assistant">
              <Markdown text={item.text} />
            </div>
          )
        if (item.type === 'approval_request')
          return (
            <ApprovalCard
              key={i}
              event={item}
              decision={approvalDecisions[item.request_id]}
              onRespond={onRespond}
            />
          )
        if (item.type === 'tool_call') {
          const arg = toolSummary(item.name, item.input)
          return (
            <details key={i} className="tool">
              <summary>
                <span className="tool-name">{item.name}</span>
                {arg ? <span className="tool-arg">{arg}</span> : null}
              </summary>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
            </details>
          )
        }
        return (
          <details key={i} className={`tool result ${item.status}`}>
            <summary>
              <span className="tool-name">{item.status === 'error' ? 'error' : 'result'}</span>
              {item.output ? <span className="tool-arg">{item.output.split('\n')[0]}</span> : null}
            </summary>
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
