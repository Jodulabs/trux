import { useEffect, useRef } from 'react'
import { connectTrux, type TruxClient } from '../truxClient'
import { useStore } from '../store'
import { Transcript } from './Transcript'
import { Composer } from './Composer'

export function ConversationView({ id }: { id: string }): React.ReactElement {
  const transcript = useStore((s) => s.transcript)
  const status = useStore((s) => s.status)
  const applyEvent = useStore((s) => s.applyEvent)
  const client = useRef<TruxClient | null>(null)

  useEffect(() => {
    const c = connectTrux({
      url: `ws://${location.host}/conversations/${id}/stream`,
      token: localStorage.getItem('trux_token') ?? '',
      onEvent: (event) => applyEvent(event),
    })
    client.current = c
    return () => c.close()
  }, [id, applyEvent])

  return (
    <section className="conversation">
      <Transcript items={transcript} />
      <Composer
        busy={status === 'thinking'}
        onSend={(text) => client.current?.sendUserMessage(text)}
        onInterrupt={() => client.current?.interrupt()}
      />
    </section>
  )
}
