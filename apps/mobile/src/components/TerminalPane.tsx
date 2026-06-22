import { useEffect, useRef } from 'react'
import { View, Text, Pressable, StyleSheet, Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { openTerminal, type TerminalHandle } from '@trux/client/terminalClient'
import { theme } from '../theme'
import { TERMINAL_HTML } from './terminalHtml.generated'

interface Props {
  conversationId: string
  visible: boolean
  onClose: () => void
}

// page → host messages.
type PageMsg =
  | { type: 'ready' }
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }

// Native terminal pane. Hosts the one xterm.js page (terminalHtml.generated) in
// a react-native-webview and bridges it to the shared openTerminal channel:
//   page → host: onMessage  (ready/input/resize)
//   host → page: ref.injectJavaScript(window.__truxRecv(...))  (output/exit)
// The spine channel is opened only after the page posts {ready} so no early
// output is dropped, and torn down on unmount / onClose.
export function TerminalPane({ conversationId, visible, onClose }: Props): React.ReactElement {
  const webRef = useRef<WebView | null>(null)
  const handleRef = useRef<TerminalHandle | null>(null)

  // Tear down the spine channel whenever the pane is hidden/unmounted.
  useEffect(() => {
    if (!visible) {
      handleRef.current?.close()
      handleRef.current = null
    }
    return () => {
      handleRef.current?.close()
      handleRef.current = null
    }
  }, [visible])

  const toPage = (msg: unknown): void => {
    const js = `window.__truxRecv(${JSON.stringify(msg)}); true;`
    webRef.current?.injectJavaScript(js)
  }

  const onMessage = (ev: WebViewMessageEvent): void => {
    let msg: PageMsg
    try {
      msg = JSON.parse(ev.nativeEvent.data) as PageMsg
    } catch {
      return
    }
    if (msg.type === 'ready') {
      // Open the channel now that the page can receive output.
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
        {visible ? (
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: TERMINAL_HTML }}
            onMessage={onMessage}
            style={styles.web}
            keyboardDisplayRequiresUserAction={false}
            // The page is fully self-contained; no remote loads.
            javaScriptEnabled
            setBuiltInZoomControls={false}
          />
        ) : null}
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
