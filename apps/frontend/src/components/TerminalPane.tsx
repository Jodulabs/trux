import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { openTerminal } from '@trux/client/terminalClient'
import '@xterm/xterm/css/xterm.css'

// A live terminal on the box, in the conversation's cwd. Mounts an xterm, bridges
// it to the spine's openTerminal channel, and tears both down on unmount.
export function TerminalPane({ conversationId }: { conversationId: string }): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const term = new Terminal({ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13, convertEol: true })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()

    const handle = openTerminal(conversationId)
    handle.onOutput((data) => term.write(data))
    handle.onExit(() => term.write('\r\n[process exited]\r\n'))
    const onData = term.onData((data) => handle.sendInput(data))
    handle.sendResize(term.cols, term.rows)

    const onResize = (): void => { fit.fit(); handle.sendResize(term.cols, term.rows) }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      onData.dispose()
      handle.close()
      term.dispose()
    }
  }, [conversationId])

  return <div className="terminal-pane" ref={ref} data-testid="terminal-pane" />
}
