import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ApprovalDecision, ImageAttachment } from '@trux/protocol'
import { connectTrux, type TruxClient } from '../truxClient'
import { useStore } from '../store'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { ApprovalCard } from './ApprovalCard'
import { Icon } from './Icon'
import { haptic } from '../haptics'
import { dequeue, enqueue, loadQueue, newMessageId } from '../outbox'

const STATUS_LABEL: Record<string, string> = {
  idle: 'Idle',
  thinking: 'Thinking…',
  awaiting_approval: 'Awaiting your approval',
  error: 'Error',
}

const CONN_LABEL: Record<string, string> = {
  reconnecting: 'Reconnecting…',
  offline: 'Offline — will retry',
  connecting: 'Connecting…',
}

// How close to the bottom counts as "following the stream". Within this, new
// content autoscrolls; past it, the user is reading history and we leave them be.
const STICK_THRESHOLD = 80

export function ConversationView({ id }: { id: string }): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const connState = useStore((s) => s.connState)
  const applyEvent = useStore((s) => s.applyEvent)
  const setConnState = useStore((s) => s.setConnState)
  const addOptimistic = useStore((s) => s.addOptimistic)
  const failPending = useStore((s) => s.failPending)
  const approvalDecisions = useStore((s) => s.approvalDecisions)
  const recordApproval = useStore((s) => s.recordApproval)
  const previewPort = useStore((s) => s.previewPort)
  const tailscaleHost = useStore((s) => s.tailscaleHost)
  const client = useRef<TruxClient | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Whether the view is currently pinned to the bottom (following the stream).
  const stuck = useRef(true)
  const [atBottom, setAtBottom] = useState(true)

  useEffect(() => {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const c = connectTrux({
      url: `${proto}//${location.host}/conversations/${id}/stream`,
      token: localStorage.getItem('trux_token') ?? '',
      // Ask the server for events past what we've already folded in.
      resumeSeq: () => useStore.getState().lastSeq,
      onConnState: (state) => {
        setConnState(state)
        // On a (re)connection, flush anything queued while we were down. Each is
        // deduped server-side by client_message_id; the echo reconciles the bubble.
        if (state === 'connected') {
          for (const m of loadQueue(id)) c.sendUserMessage(m.text, m.attachments, m.client_message_id)
        }
      },
      onEvent: (event) => {
        // A delivered message's echo clears it from the durable outbox.
        if (event.type === 'user_text' && event.client_message_id) dequeue(id, event.client_message_id)
        if (event.type === 'history_delta' || event.type === 'history_snapshot') {
          for (const e of event.events) {
            if (e.type === 'user_text' && e.client_message_id) dequeue(id, e.client_message_id)
          }
        }
        // Physical taps for the moments you're not looking at the screen.
        if (event.type === 'approval_request') haptic('notify')
        if (event.type === 'turn_complete') haptic('success')
        // A non-recoverable error means the turn won't echo — stop the pending
        // bubble spinning forever and drop it from the outbox so it can't retry.
        if (event.type === 'error' && !event.recoverable) {
          haptic('error')
          for (const cid of failPending()) dequeue(id, cid)
        }
        applyEvent(event)
      },
    })
    client.current = c
    return () => c.close()
  }, [id, applyEvent, setConnState, addOptimistic, failPending])

  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stuck.current = distance <= STICK_THRESHOLD
    setAtBottom(distance <= STICK_THRESHOLD)
  }, [])

  // Sticky-but-polite: scroll to bottom on new content only if the user was
  // already there. Never yanks a reader who scrolled up. text_delta grows the
  // last item without changing length, so we also key on the live text's length
  // (streamSig) — otherwise streaming prose scrolls out of view.
  const lastItem = transcript[transcript.length - 1]
  const streamSig = lastItem?.type === 'text' ? lastItem.text.length : 0
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stuck.current) el.scrollTop = el.scrollHeight
  }, [transcript.length, streamSig, status])

  const scrollToLatest = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    stuck.current = true
    setAtBottom(true)
  }

  const onSend = (text: string, attachments?: ImageAttachment[]): void => {
    const cid = newMessageId()
    // Render instantly (sending), queue durably, then put it on the wire. The
    // server echo reconciles the bubble; the queue covers a dead socket.
    addOptimistic({ type: 'user_text', turn_id: '', text, attachments, client_message_id: cid, pending: true })
    enqueue(id, { client_message_id: cid, text, attachments })
    stuck.current = true
    setAtBottom(true)
    client.current?.sendUserMessage(text, attachments, cid)
    haptic('light')
  }

  const onRespond = (requestId: string, decision: ApprovalDecision): void => {
    client.current?.respondApproval(requestId, decision)
    recordApproval(requestId, decision)
    haptic('medium')
  }

  const busy = status === 'thinking' || status === 'awaiting_approval'
  const connNote = connState !== 'connected' ? CONN_LABEL[connState] : null

  // The latest still-unresolved approval — pinned above the composer so a blocking
  // decision can never scroll off-screen and strand the agent on a glanced-at phone.
  const pendingApproval = (() => {
    if (status !== 'awaiting_approval') return null
    for (let i = transcript.length - 1; i >= 0; i--) {
      const it = transcript[i]
      if (it.type === 'approval_request' && !approvalDecisions[it.request_id]) return it
    }
    return null
  })()

  const previewUrl = previewPort !== null
    ? tailscaleHost
      ? `https://${tailscaleHost}:${previewPort}`
      : `http://localhost:${previewPort}`
    : null

  return (
    <section className="conversation">
      <div className="conversation-bar">
        <div data-testid="status-line" className={`status ${status}`}>{STATUS_LABEL[status] ?? status}</div>
        {connNote ? (
          <div data-testid="conn-state" className={`conn ${connState}`}>{connNote}</div>
        ) : null}
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
      <div className="transcript-area">
        <div className="transcript-scroll" ref={scrollRef} onScroll={onScroll}>
          <Transcript items={transcript} approvalDecisions={approvalDecisions} onRespond={onRespond} status={status} />
        </div>
        {!atBottom ? (
          <button
            className="scroll-latest"
            data-testid="scroll-latest"
            aria-label="Scroll to latest"
            onClick={scrollToLatest}
          >
            <Icon name="down" size={18} />
          </button>
        ) : null}
      </div>
      {pendingApproval ? (
        <ApprovalCard
          key={pendingApproval.request_id}
          event={pendingApproval}
          decision={approvalDecisions[pendingApproval.request_id]}
          onRespond={onRespond}
          pinned
        />
      ) : null}
      <Composer
        busy={busy}
        onSend={onSend}
        onInterrupt={() => {
          client.current?.interrupt()
          haptic('medium')
        }}
      />
    </section>
  )
}
