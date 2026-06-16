import { useEffect, useState } from 'react'
import { connectTrux } from './truxClient'

type ConnState = { state: 'connecting' } | { state: 'connected'; protocol: number }

export function App(): React.ReactElement {
  const [conn, setConn] = useState<ConnState>({ state: 'connecting' })

  useEffect(() => {
    const client = connectTrux({
      url: `ws://${location.host}/conversations/dev/stream`,
      onReady: (hello) => setConn({ state: 'connected', protocol: hello.protocol_version }),
    })
    return () => client.close()
  }, [])

  return (
    <main>
      <h1>Trux</h1>
      <p data-testid="status">
        {conn.state === 'connected' ? `Connected — NCP v${conn.protocol}` : 'Connecting…'}
      </p>
    </main>
  )
}
