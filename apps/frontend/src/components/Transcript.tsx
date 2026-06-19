import type { ApprovalDecision } from '@trux/protocol'
import type { TranscriptItem } from '../store'
import { ApprovalCard } from './ApprovalCard'
import { Markdown } from './Markdown'
import { ActivityGroup } from './ActivityGroup'
import type { ToolItem } from './ActivityGroup'

interface Props {
  items: TranscriptItem[]
  approvalDecisions: Record<string, ApprovalDecision>
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  status?: string
}

// A render-time row: either a single transcript item or a folded run of tool
// activity. Folding consecutive tool_call/tool_result items keeps a turn's dozens
// of Read/Grep/Bash calls from burying the prose answer.
type Row =
  | { kind: 'item'; item: TranscriptItem; index: number }
  | { kind: 'activity'; tools: ToolItem[]; key: number }

function groupRows(items: TranscriptItem[]): Row[] {
  const rows: Row[] = []
  let run: ToolItem[] = []
  let runStart = -1
  const flush = (): void => {
    if (run.length > 0) {
      rows.push({ kind: 'activity', tools: run, key: runStart })
      run = []
      runStart = -1
    }
  }
  items.forEach((item, index) => {
    if (item.type === 'tool_call' || item.type === 'tool_result') {
      if (runStart === -1) runStart = index
      run.push(item)
    } else {
      flush()
      rows.push({ kind: 'item', item, index })
    }
  })
  flush()
  return rows
}

export function Transcript({
  items,
  approvalDecisions,
  onRespond,
  status,
}: Props): React.ReactElement {
  const rows = groupRows(items)
  // The last prose item is "live" while the agent is thinking → show the caret.
  const lastTextIndex = (() => {
    for (let i = items.length - 1; i >= 0; i--) if (items[i].type === 'text') return i
    return -1
  })()
  const streaming = status === 'thinking'

  return (
    <div className="transcript" data-testid="transcript">
      {rows.map((row) => {
        if (row.kind === 'activity') {
          return <ActivityGroup key={`a${row.key}`} tools={row.tools} running={streaming} />
        }
        const { item, index: i } = row
        if (item.type === 'user_text') {
          const pending = 'pending' in item && item.pending
          const failed = 'failed' in item && item.failed
          return (
            <div key={i} className={`msg user${pending ? ' pending' : ''}${failed ? ' failed' : ''}`}>
              {item.text}
              {pending ? <span className="msg-state" data-testid="msg-sending">sending…</span> : null}
              {failed ? <span className="msg-state failed" data-testid="msg-failed">failed — will retry</span> : null}
            </div>
          )
        }
        if (item.type === 'text')
          return (
            <div key={i} className="msg assistant">
              <Markdown text={item.text} />
              {streaming && i === lastTextIndex ? <span className="caret" data-testid="stream-caret" /> : null}
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
        return null
      })}
    </div>
  )
}
