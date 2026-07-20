import { useEffect, useRef } from 'react'
import { View, StyleSheet } from 'react-native'
import { openTerminal, type TerminalHandle } from '@trux/client/terminalClient'
import { TERMINAL_HTML } from '../terminalHtml.generated'

interface Props {
  conversationId: string
}

export function InlineTerminal({ conversationId }: Props): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const handleRef = useRef<TerminalHandle | null>(null)

  const toPage = (msg: unknown): void => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*')
  }

  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      if (iframeRef.current && ev.source !== iframeRef.current.contentWindow) return
      let msg: { type: string; data?: string; cols?: number; rows?: number }
      try {
        msg = (typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data) as typeof msg
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
        handleRef.current?.sendInput(msg.data!)
      } else if (msg.type === 'resize') {
        handleRef.current?.sendResize(msg.cols!, msg.rows!)
      }
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      handleRef.current?.close()
      handleRef.current = null
    }
  }, [conversationId])

  return (
    <View style={styles.shell}>
      <iframe
        ref={iframeRef}
        srcDoc={TERMINAL_HTML}
        title="Terminal"
        style={{ border: 'none', width: '100%', height: '100%', background: '#000' }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: '#000' },
})
