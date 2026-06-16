import { useState } from 'react'

interface ComposerProps {
  busy: boolean
  onSend: (text: string) => void
  onInterrupt: () => void
}

export function Composer({ busy, onSend, onInterrupt }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('')
  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
  }
  return (
    <div className="composer">
      <textarea
        data-testid="composer-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="Message Claude…"
      />
      {busy ? (
        <button data-testid="interrupt" onClick={onInterrupt}>Stop</button>
      ) : (
        <button data-testid="send" onClick={submit}>Send</button>
      )}
    </div>
  )
}
