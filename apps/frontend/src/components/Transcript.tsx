import type { TranscriptItem } from '../store'

export function Transcript({ items }: { items: TranscriptItem[] }): React.ReactElement {
  return (
    <div data-testid="transcript">
      {items.map((item, i) => {
        if (item.type === 'user_text') return <p key={i} className="msg user">{item.text}</p>
        if (item.type === 'text') return <p key={i} className="msg assistant">{item.text}</p>
        if (item.type === 'tool_call')
          return (
            <details key={i} className="tool">
              <summary>🔧 {item.name}</summary>
              <pre>{JSON.stringify(item.input, null, 2)}</pre>
            </details>
          )
        return (
          <details key={i} className={`tool ${item.status}`}>
            <summary>← {item.status}</summary>
            <pre>{item.output}</pre>
          </details>
        )
      })}
    </div>
  )
}
