import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react'
import type { AgentCapabilities, AgentCommand, ApprovalDecision, ImageAttachment, TurnConfig } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import {
  clearActiveHandlers,
  getConnection,
  openConnection,
  setActiveHandlers,
} from '@trux/client/connectionManager'
import { enqueue, newMessageId, dequeue } from '@trux/client/outbox'
import { Transcript } from './Transcript'
import { Composer } from './Composer'
import { ApprovalCard } from './ApprovalCard'
import { Icon } from './Icon'
import { haptic } from '../haptics'

function elapsedLabel(secs: number): string {
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

// Derive a short conversation title from the first user message: first
// non-empty line, trimmed, capped at 60 chars.
export function deriveTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  const t = firstLine.trim()
  return t.length > 60 ? t.slice(0, 60) : t
}

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

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
  const conversations = useStore((s) => s.conversations)
  const setTitle = useStore((s) => s.setTitle)
  const conv = conversations.find((c) => c.id === id)
  const convTitle = conv?.title ?? (conv ? shortCwd(conv.cwd) : '')
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // Whether the view is currently pinned to the bottom (following the stream).
  const stuck = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [thinkingSecs, setThinkingSecs] = useState(0)
  const thinkingStart = useRef<number | null>(null)

  // Unified model/control picker state. The composer pre-fills from the
  // conversation's sticky (last-used) selection and lets the user change it
  // per turn. trux declares/renders/routes; the backend's native knobs decide
  // behavior. Empty manifest → no picker rendered (codex/opencode today).
  const [agents, setAgents] = useState<AgentCapabilities[]>([])
  const [config, setConfig] = useState<TurnConfig>({
    model: conv?.model ?? null,
    options: conv?.options ?? {},
  })
  useEffect(() => {
    void api.listAgents().then((r) => setAgents(r.agents ?? [])).catch(() => {})
  }, [])
  // Re-seed when the stored selection changes (e.g. after the conversation loads).
  useEffect(() => {
    setConfig({ model: conv?.model ?? null, options: conv?.options ?? {} })
  }, [conv?.model, conv?.options])
  const caps = agents.find((a) => a.agent === conv?.agent)

  const [commands, setCommands] = useState<AgentCommand[]>([])
  useEffect(() => {
    if (!conv) return
    void api.discoverCommands(conv.agent, conv.cwd).then((r) => setCommands(r.commands ?? [])).catch(() => {})
  }, [conv?.agent, conv?.cwd])

  // Register active-conversation event handlers with the connection manager.
  // The manager calls these when events arrive for `id`, regardless of which
  // component created the underlying TruxClient.
  useEffect(() => {
    openConnection(id)
    setActiveHandlers({
      id,
      onConnState(state) {
        setConnState(state)
      },
      onEvent(event) {
        // Physical taps for the moments you're not looking at the screen.
        if (event.type === 'approval_request') haptic('notify')
        if (event.type === 'turn_complete') { haptic('success') }
        // A non-recoverable error means the turn won't echo — stop the pending
        // bubble spinning forever and drop it from the outbox so it can't retry.
        if (event.type === 'error' && !event.recoverable) {
          haptic('error')
          for (const cid of failPending()) dequeue(id, cid)
        }
        applyEvent(event)
      },
    })
    return () => clearActiveHandlers()
  }, [id, applyEvent, setConnState, failPending])

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
    // Auto-title: derive a title from the first user message of an untitled
    // conversation, persist it via the rename API, and reflect it in the store.
    const noUserYet = !transcript.some((it) => it.type === 'user_text')
    if (conv && !conv.title && noUserYet) {
      const title = deriveTitle(text)
      if (title) {
        setTitle(id, title)
        void api.renameConversation(id, title).catch(() => {})
      }
    }
    const cid = newMessageId()
    // Render instantly (sending), queue durably, then put it on the wire. The
    // server echo reconciles the bubble; the queue covers a dead socket.
    addOptimistic({ type: 'user_text', turn_id: '', text, attachments, client_message_id: cid, pending: true })
    enqueue(id, { client_message_id: cid, text, attachments, config })
    stuck.current = true
    setAtBottom(true)
    getConnection(id)?.sendUserMessage(text, attachments, cid, config)
    haptic('light')
  }

  const onRespond = (requestId: string, decision: ApprovalDecision): void => {
    getConnection(id)?.respondApproval(requestId, decision)
    recordApproval(requestId, decision)
    haptic('medium')
  }

  // Elapsed timer while agent is thinking.
  useEffect(() => {
    if (status === 'thinking') {
      if (thinkingStart.current === null) thinkingStart.current = Date.now()
      const tick = (): void => setThinkingSecs(Math.floor((Date.now() - (thinkingStart.current ?? Date.now())) / 1000))
      tick()
      const h = setInterval(tick, 1000)
      return () => clearInterval(h)
    } else {
      thinkingStart.current = null
      setThinkingSecs(0)
    }
  }, [status])



  const busy = status === 'thinking' || status === 'awaiting_approval'
  const connNote = connState !== 'connected' ? CONN_LABEL[connState] : null
  const statusLabel = useMemo(() => {
    if (status === 'thinking') return `Thinking… ${elapsedLabel(thinkingSecs)}`
    return STATUS_LABEL[status] ?? status
  }, [status, thinkingSecs])

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

  const totalCost = useStore((s) => s.convMeta[id]?.totalCost ?? 0)

  return (
    <section className="conversation">
      <div className="conversation-bar">
        {convTitle ? (
          <span className="conv-title" data-testid="conv-title">{convTitle}</span>
        ) : null}
        <div data-testid="status-line" className={`status ${status}`}>{statusLabel}</div>
        {connNote ? (
          <div data-testid="conn-state" className={`conn ${connState}`}>{connNote}</div>
        ) : null}
        {totalCost > 0 ? (
          <span className="cost-badge" data-testid="cost-badge">${totalCost.toFixed(4)}</span>
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
          <Transcript items={transcript} approvalDecisions={approvalDecisions} onRespond={onRespond} status={status} conversationId={id} />
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
        conversationId={id}
        busy={busy}
        caps={caps}
        commands={commands}
        config={config}
        onConfigChange={setConfig}
        onSend={onSend}
        onInterrupt={() => {
          getConnection(id)?.interrupt()
          haptic('medium')
        }}
      />
    </section>
  )
}
