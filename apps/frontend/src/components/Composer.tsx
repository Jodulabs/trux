import { useRef, useState } from 'react'
import type { ImageAttachment } from '@trux/protocol'
import { addSnippet, deleteSnippet, loadSnippets, type Snippet } from '../snippets'
import { Icon } from './Icon'

interface ComposerProps {
  busy: boolean
  onSend: (text: string, attachments?: ImageAttachment[]) => void
  onInterrupt: () => void
}

function formatSession(s: Snippet): string {
  return s.label
}

function readFileAsDataUrl(file: File): Promise<{ media_type: string; data: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // data:image/png;base64,<data>
      const comma = result.indexOf(',')
      const header = result.slice(5, comma) // strip "data:"
      const semi = header.indexOf(';')
      const media_type = semi >= 0 ? header.slice(0, semi) : header
      const data = result.slice(comma + 1)
      resolve({ media_type, data })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function Composer({ busy, onSend, onInterrupt }: ComposerProps): React.ReactElement {
  const [text, setText] = useState('')
  const [showSnippets, setShowSnippets] = useState(false)
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    if (attachments.length > 0) {
      onSend(trimmed, attachments)
    } else {
      onSend(trimmed)
    }
    setText('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const openSnippets = (): void => {
    setSnippets(loadSnippets())
    setShowSnippets(true)
  }

  const insertSnippet = (snippet: Snippet): void => {
    setText((prev) => (prev ? `${prev}\n${snippet.text}` : snippet.text))
    setShowSnippets(false)
    textareaRef.current?.focus()
  }

  const saveSnippet = (): void => {
    const trimmed = text.trim()
    if (!trimmed) return
    addSnippet(trimmed)
  }

  const removeSnippet = (id: string): void => {
    deleteSnippet(id)
    setSnippets((prev) => prev.filter((s) => s.id !== id))
  }

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (!files) return
    const results = await Promise.all(
      Array.from(files)
        .filter((f) => f.type.startsWith('image/'))
        .map(async (f) => {
          const { media_type, data } = await readFileAsDataUrl(f)
          return { kind: 'image' as const, media_type, data }
        }),
    )
    setAttachments((prev) => [...prev, ...results])
  }

  const removeAttachment = (index: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="composer">
      {showSnippets && (
        <div className="snippet-panel" data-testid="snippet-panel">
          <div className="snippet-panel-header">
            <span>Snippets</span>
            <button data-testid="snippet-panel-close" onClick={() => setShowSnippets(false)}>✕</button>
          </div>
          {snippets.length === 0 ? (
            <p className="snippet-empty">No saved snippets yet. Save the current message with the bookmark.</p>
          ) : (
            snippets.map((s) => (
              <div key={s.id} className="snippet-row">
                <button className="snippet-insert" data-testid={`snippet-insert-${s.id}`} onClick={() => insertSnippet(s)}>
                  {formatSession(s)}
                </button>
                <button className="snippet-delete" data-testid={`snippet-delete-${s.id}`} onClick={() => removeSnippet(s.id)} aria-label="Delete snippet">✕</button>
              </div>
            ))
          )}
        </div>
      )}
      {attachments.length > 0 && (
        <div className="attachment-previews" data-testid="attachment-previews">
          {attachments.map((a, i) => (
            <div key={i} className="attachment-thumb">
              <img src={`data:${a.media_type};base64,${a.data}`} alt={`attachment ${i + 1}`} />
              <button
                className="attachment-remove"
                data-testid={`attachment-remove-${i}`}
                onClick={() => removeAttachment(i)}
                aria-label="Remove image"
              >✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-field">
        <textarea
          ref={textareaRef}
          data-testid="composer-input"
          value={text}
          onChange={handleChange}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Message Claude…"
        />
        <div className="composer-tools">
          <button className="icon-btn" data-testid="snippet-save" title="Save as snippet" aria-label="Save as snippet" onClick={saveSnippet}>
            <Icon name="bookmark" size={18} />
          </button>
          <button className="icon-btn" data-testid="snippet-open" title="Insert snippet" aria-label="Insert snippet" onClick={openSnippets}>
            <Icon name="list" size={18} />
          </button>
          <button className="icon-btn" data-testid="attach-image" title="Attach image" aria-label="Attach image" onClick={() => fileInputRef.current?.click()}>
            <Icon name="attach" size={18} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            data-testid="file-input"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          {busy ? (
            <button className="send-btn stop" data-testid="interrupt" title="Stop" aria-label="Stop" onClick={onInterrupt}>
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button className="send-btn" data-testid="send" title="Send" aria-label="Send" onClick={submit}>
              <Icon name="send" size={20} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
