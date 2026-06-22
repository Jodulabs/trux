import { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { openTerminal, type TerminalHandle } from '@trux/client/terminalClient'
import { theme } from '../theme'
import { TERMINAL_HTML } from './terminalHtml.generated'

interface Props {
  conversationId: string
  visible: boolean
  onClose: () => void
}

type PageMsg =
  | { type: 'ready' }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// Web terminal pane (react-native-web). Hosts the one xterm.js page in an
// <iframe srcDoc> and bridges it to the shared openTerminal channel:
//   page → host: window 'message' listener  (ready/input/resize)
//   host → page: iframe.contentWindow.postMessage  (output/exit)
// The channel opens only after {ready}, and is torn down on unmount / onClose.
// On web, react-native-web maps the RN <Modal>/<View>/<Pressable> to DOM, but we
// need a raw <iframe>, so the body is a small DOM tree rendered via a host View
// that we populate with an actual iframe element ref.
export function TerminalPane({ conversationId, visible, onClose }: Props): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const handleRef = useRef<TerminalHandle | null>(null)

  const toPage = (msg: unknown): void => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }

  useEffect(() => {
    if (!visible) {
      handleRef.current?.close()
      handleRef.current = null
      return
    }

    const onMessage = (ev: MessageEvent): void => {
      // Only accept messages from our iframe's window.
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return
      let msg: PageMsg
      const raw = ev.data
      try {
        msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as PageMsg
      } catch {
        return
      }
      if (!msg || typeof msg.type !== 'string') return
      if (msg.type === 'ready') {
        handleRef.current?.close()
        const handle = openTerminal(conversationId)
        handle.onOutput((data) => toPage({ type: 'output', data }))
        handle.onExit((code) => toPage({ type: 'exit', code }))
        handle.onError((message) => toPage({ type: 'output', data: `\r\n[error] ${message}\r\n` }))
        handleRef.current = handle
      } else if (msg.type === 'input') {
        handleRef.current?.sendInput(msg.data)
      } else if (msg.type === 'resize') {
        handleRef.current?.sendResize(msg.cols, msg.rows)
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      handleRef.current?.close()
      handleRef.current = null
    }
  }, [visible, conversationId])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Terminal</Text>
          <View style={styles.headerSpacer} />
          <Pressable hitSlop={12} onPress={onClose} accessibilityLabel="Close terminal">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.web}>
          {visible ? (
            // react-native-web passes unknown DOM props through; an iframe element
            // is valid here and gives us the srcDoc/contentWindow bridge.
            <iframe
              ref={iframeRef}
              srcDoc={TERMINAL_HTML}
              title="Terminal"
              style={{ border: 'none', width: '100%', height: '100%', background: theme.ink }}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
  headerSpacer: { flex: 1 },
  close: { color: theme.textDim, fontSize: 18, fontFamily: theme.fontSans },
  web: { flex: 1, backgroundColor: theme.ink },
})
