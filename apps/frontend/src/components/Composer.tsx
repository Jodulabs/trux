import { useRef, useState } from 'react'

interface ComposerProps {
  busy: boolean
  onSend: (text: string) => void
  onInterrupt: () => void
}

export function Composer({ busy, onSend, onInterrupt }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    onSend(trimmed)
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  return (
    <div className="composer">
      <textarea
        ref={textareaRef}
        data-testid="composer-input"
        value={text}
        onChange={handleChange}
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
