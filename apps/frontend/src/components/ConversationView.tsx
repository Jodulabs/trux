import { useEffect, useRef } from 'react'
import type { ApprovalDecision } from '@trux/protocol'
import { connectTrux, type TruxClient } from '../truxClient'
import { useStore } from '../store'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  awaiting_approval: 'Awaiting your approval',
  error: 'Error',
}

export function ConversationView({ id }: { id: string }): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const applyEvent = useStore((s) => s.applyEvent)
  const approvalDecisions = useStore((s) => s.approvalDecisions)
  const recordApproval = useStore((s) => s.recordApproval)
  const previewPort = useStore((s) => s.previewPort)
  const tailscaleHost = useStore((s) => s.tailscaleHost)
  const client = useRef<TruxClient | null>(null)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const c = connectTrux({
      url: `${proto}//${location.host}/conversations/${id}/stream`,
      token: localStorage.getItem('trux_token') ?? '',
      onEvent: (event) => applyEvent(event),
    })
    client.current = c
    return () => c.close()
  }, [id, applyEvent])

  const onRespond = (requestId: string, decision: ApprovalDecision): void => {
    client.current?.respondApproval(requestId, decision)
    recordApproval(requestId, decision)
  }

  const busy = status === 'thinking' || status === 'awaiting_approval'

  const previewUrl = previewPort !== null
    ? tailscaleHost
      ? `https://${tailscaleHost}:${previewPort}`
      : `http://localhost:${previewPort}`
    : null

  return (
    <section className="conversation">
      <div className="conversation-bar">
        <div data-testid="status-line" className={`status ${status}`}>{STATUS_LABEL[status] ?? status}</div>
        {previewUrl !== null ? (
          <button
            className="open-preview"
            data-testid="open-preview"
            onClick={() => window.open(previewUrl, '_blank')}
          >
            ◳ preview :{previewPort}
          </button>
        ) : null}
      </div>
      <Transcript items={transcript} approvalDecisions={approvalDecisions} onRespond={onRespond} />
      <Composer
        busy={busy}
        onSend={(text, attachments) => client.current?.sendUserMessage(text, attachments)}
        onInterrupt={() => client.current?.interrupt()}
      />
    </section>
  )
}
