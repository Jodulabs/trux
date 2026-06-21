import { useEffect, useRef } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useStore } from '@trux/client/store'
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

// Phase A4 conversation view: opens a persistent WS connection for `id` via the
// shared connectionManager, routes streamed events into the shared store, and
// renders a plain-text Transcript + Composer with the connection-state banner
// the spec calls out. Rich tool-cards, approvals UI, markdown, and diff land in
// Phase B; this proves the spine streams end-to-end on native.
export function ConversationView({ id }: Props): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const connState = useStore((s) => s.connState)
  const applyEvent = useStore((s) => s.applyEvent)
  const setConnState = useStore((s) => s.setConnState)
  const addOptimistic = useStore((s) => s.addOptimistic)
  const failPending = useStore((s) => s.failPending)
  const reloaded = useRef(false)

  // Open the connection once and register as the active conversation so events
  // for `id` route here (transcript, haptics). Mirrors the PWA's ConversationView.
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

  // Silence the unused-ref lint for the reloaded flag (kept for A4 follow-up:
  // reload transcript on reconnect when the server speaks seq).
  void reloaded

  const onSend = (text: string): void => {
    const cid = newMessageId()
    addOptimistic({ type: 'user_text', turn_id: '', text, client_message_id: cid, pending: true })
    enqueue(id, { client_message_id: cid, text })
    getConnection(id)?.sendUserMessage(text, undefined, cid)
    haptic('light')
  }

  const connNote = connState !== 'connected' ? CONN_LABEL[connState] : null

  return (
    <View style={styles.shell}>
      {connNote ? (
        <View style={styles.connBanner}>
          <Text style={styles.connText}>{connNote}</Text>
        </View>
      ) : null}
      <Transcript items={transcript} status={status} />
      <Composer
        busy={status === 'thinking' || status === 'awaiting_approval'}
        onSend={onSend}
        onInterrupt={() => getConnection(id)?.interrupt()}
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
