import { useEffect, useRef, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import type { AgentCapabilities, ApprovalDecision, TurnConfig } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { openConnection, setActiveHandlers, clearActiveHandlers, getConnection, enqueue } from '@trux/client/connectionManager'
import { newMessageId, dequeue } from '@trux/client/outbox'
import { theme } from '../theme'
import { haptic } from '../haptics'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

interface Props {
  id: string
  onBack: () => void
}

const CONN_LABEL: Record<string, string> = {
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline — will retry',
}

// Phase C: opens a persistent WS connection for `id` via the shared
// connectionManager, routes streamed events into the shared store, and renders
// the Transcript (with happy tool-view cards) + Composer with the
// connection-state banner. Approvals route through respondApproval via the WS.
// ControlPicker (model/effort) is wired when the agent exposes controls.
export function ConversationView({ id }: Props): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const connState = useStore((s) => s.connState)
  const approvalDecisions = useStore((s) => s.approvalDecisions)
  const conversations = useStore((s) => s.conversations)
  const applyEvent = useStore((s) => s.applyEvent)
  const setConnState = useStore((s) => s.setConnState)
  const addOptimistic = useStore((s) => s.addOptimistic)
  const failPending = useStore((s) => s.failPending)
  const recordApproval = useStore((s) => s.recordApproval)
  const reloaded = useRef(false)

  const conv = conversations.find((c) => c.id === id)
  const [caps, setCaps] = useState<AgentCapabilities | undefined>()
  const [config, setConfig] = useState<TurnConfig>({ model: null, options: {} })

  // Seed config from the conversation's sticky selection (model/options).
  useEffect(() => {
    if (!conv) return
    setConfig({ model: conv.model, options: { ...conv.options } })
  }, [conv?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch agent capabilities for the ControlPicker.
  useEffect(() => {
    if (!conv?.agent) return
    void api.listAgents().then((r) => {
      const found = r.agents.find((a) => a.agent === conv.agent)
      setCaps(found)
    }).catch(() => {})
  }, [conv?.agent])

  useEffect(() => {
    openConnection(id)
    setActiveHandlers({
      id,
      onConnState(state) {
        setConnState(state)
      },
      onEvent(event) {
        if (event.type === 'approval_request') haptic('notify')
        if (event.type === 'turn_complete') haptic('success')
        if (event.type === 'error' && !event.recoverable) {
          haptic('error')
          for (const cid of failPending()) dequeue(id, cid)
        }
        applyEvent(event)
      },
    })
    return () => clearActiveHandlers()
  }, [id, applyEvent, setConnState, failPending])

  void reloaded

  const onSend = (text: string, cfg?: TurnConfig): void => {
    const cid = newMessageId()
    addOptimistic({ type: 'user_text', turn_id: '', text, client_message_id: cid, pending: true })
    enqueue(id, { client_message_id: cid, text, config: cfg })
    getConnection(id)?.sendUserMessage(text, undefined, cid, cfg)
    haptic('light')
  }

  const onRespond = (requestId: string, decision: ApprovalDecision): void => {
    getConnection(id)?.respondApproval(requestId, decision)
    recordApproval(requestId, decision)
    haptic('medium')
  }

  const connNote = connState !== 'connected' ? CONN_LABEL[connState] : null

  return (
    <View style={styles.shell}>
      {connNote ? (
        <View style={styles.connBanner}>
          <Text style={styles.connText}>{connNote}</Text>
        </View>
      ) : null}
      <Transcript
        items={transcript}
        status={status}
        approvalDecisions={approvalDecisions}
        onRespond={onRespond}
        sessionId={id}
      />
      <Composer
        busy={status === 'thinking' || status === 'awaiting_approval'}
        onSend={onSend}
        onInterrupt={() => getConnection(id)?.interrupt()}
        caps={caps}
        config={config}
        onConfigChange={setConfig}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  connBanner: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: theme.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  connText: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono, textAlign: 'center' },
})
