import { useEffect, useRef, useState } from 'react'
import type { ToolCallEvent, ToolResultEvent } from '@trux/protocol'
import { api } from '@trux/client/api'
import { toolSummary } from '@trux/client/tools'
import { Icon } from './Icon'
import { DiffView } from './DiffView'

export type ToolItem = ToolCallEvent | ToolResultEvent

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

interface Props {
  tools: ToolItem[]
  running: boolean
  conversationId?: string
}

// Pair each tool_call with its tool_result (by tool_id) for rendering.
interface Step {
  call?: ToolCallEvent
  result?: ToolResultEvent
}
function pair(tools: ToolItem[]): Step[] {
  const steps: Step[] = []
  const byId = new Map<string, Step>()
  for (const t of tools) {
    if (t.type === 'tool_call') {
      const step: Step = { call: t }
      steps.push(step)
      byId.set(t.tool_id, step)
    } else {
      const existing = byId.get(t.tool_id)
      if (existing) existing.result = t
      else steps.push({ result: t })
    }
  }
  return steps
}

function elapsedLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

// A folded run of tool activity: one collapsible cluster instead of a wall of
// boxes. Expanded while running, auto-collapses when the turn settles — but never
// fights a manual toggle. A child awaiting approval forces it open.
export function ActivityGroup({ tools, running, conversationId }: Props): React.ReactElement {
  const steps = pair(tools)
  const [manual, setManual] = useState<boolean | null>(null) // null = follow auto
  const open = manual ?? running

  // A live elapsed timer while the run is active (no wire timestamps, so we count
  // from first render of an active group). Ticks once a second; stops when settled.
  const [secs, setSecs] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (!running) {
      startRef.current = null
      return
    }
    if (startRef.current === null) startRef.current = Date.now()
    const tick = (): void => setSecs(Math.floor((Date.now() - (startRef.current ?? Date.now())) / 1000))
    tick()
    const h = setInterval(tick, 1000)
    return () => clearInterval(h)
  }, [running])

  const [diffView, setDiffView] = useState<{ path: string; diff: string } | null>(null)

  const openDiff = async (path: string): Promise<void> => {
    if (!conversationId) return
    try {
      const { diff } = await api.gitDiff(conversationId, { path })
      setDiffView({ path, diff })
    } catch {}
  }

  const latest = steps[steps.length - 1]
  const latestName = latest?.call?.name ?? (latest?.result ? 'result' : 'tool')
  const latestArg = latest?.call ? toolSummary(latest.call.name, latest.call.input) : null
  const hasError = steps.some((s) => s.result?.status === 'error')

  return (
    <>
      {diffView ? (
        <DiffView title={diffView.path} diff={diffView.diff} onClose={() => setDiffView(null)} />
      ) : null}
      <div className={`activity${running ? ' running' : ''}${hasError ? ' has-error' : ''}`} data-testid="activity-group">
        <button
          className="activity-head"
          data-testid="activity-toggle"
          aria-expanded={open}
          onClick={() => setManual(!open)}
        >
          <span className={`activity-chevron${open ? ' open' : ''}`}><Icon name="chevron" size={14} /></span>
          <span className="activity-name">{running ? latestName : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}</span>
          {running && latestArg ? <span className="activity-arg">{latestArg}</span> : null}
          <span className="activity-meta">
            {running ? elapsedLabel(secs) : `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
          </span>
        </button>
        {open && (
          <div className="activity-body">
            {steps.map((step, i) => {
              const name = step.call?.name ?? 'result'
              const arg = step.call ? toolSummary(step.call.name, step.call.input) : null
              const status = step.result?.status
              const filePath = step.call && EDIT_TOOLS.has(step.call.name)
                ? (step.call.input as { file_path?: string }).file_path
                : undefined
              return (
                <details key={i} className={`tool${status ? ` result ${status}` : ''}`}>
                  <summary>
                    <span className="tool-name">{name}</span>
                    {arg ? <span className="tool-arg">{arg}</span> : null}
                    {status === 'error' ? <span className="tool-badge error">error</span> : null}
                    {filePath && conversationId && !running ? (
                      <button
                        className="tool-diff-btn"
                        data-testid="tool-diff-btn"
                        onClick={(e) => { e.preventDefault(); void openDiff(filePath) }}
                        aria-label={`View diff for ${filePath}`}
                      >diff</button>
                    ) : null}
                  </summary>
                  {step.call ? <pre>{JSON.stringify(step.call.input, null, 2)}</pre> : null}
                  {step.result?.output ? <pre>{step.result.output}</pre> : null}
                  {step.result?.images?.map((img, j) => (
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
        )}
      </div>
    </>
  )
}
