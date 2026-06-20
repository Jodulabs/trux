import { useEffect, useRef, useState } from 'react'
import type { AgentCapabilities, ImageAttachment, TurnConfig } from '@trux/protocol'
import { Icon } from './Icon'
import { ControlPicker } from './ControlPicker'

function draftKey(id: string): string { return `trux-draft-${id}` }
function loadDraft(id: string): string {
  try { return localStorage.getItem(draftKey(id)) ?? '' } catch { return '' }
}
function saveDraft(id: string, text: string): void {
  try {
    if (text) localStorage.setItem(draftKey(id), text)
    else localStorage.removeItem(draftKey(id))
  } catch {}
}

// Touch devices have no Shift key, so "Enter sends / Shift+Enter newline" makes
// newlines impossible. On a coarse pointer, Enter inserts a newline and the Send
// button is the only way to submit; a hardware keyboard keeps Enter-to-send.
const coarsePointer =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches

interface ComposerProps {
  conversationId?: string
  busy: boolean
  caps?: AgentCapabilities
  config?: TurnConfig
  onConfigChange?: (next: TurnConfig) => void
  onSend: (text: string, attachments?: ImageAttachment[]) => void
  onInterrupt: () => void
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

// Web Speech API (not typed in lib.dom by default for older TS versions).
interface SpeechRecognitionEvent extends Event { results: SpeechRecognitionResultList }
interface SpeechRecognitionResultList { length: number; item(i: number): SpeechRecognitionResult; [i: number]: SpeechRecognitionResult }
interface SpeechRecognitionResult { isFinal: boolean; [i: number]: SpeechRecognitionAlternative }
interface SpeechRecognitionAlternative { transcript: string }
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean; interimResults: boolean; lang: string
  start(): void; stop(): void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onend: (() => void) | null
}
declare const SpeechRecognition: { new(): SpeechRecognitionInstance } | undefined
declare const webkitSpeechRecognition: { new(): SpeechRecognitionInstance } | undefined
const SpeechRecognitionClass = typeof SpeechRecognition !== 'undefined' ? SpeechRecognition
  : typeof webkitSpeechRecognition !== 'undefined' ? webkitSpeechRecognition
  : null

export function Composer({ conversationId, busy, caps, config, onConfigChange, onSend, onInterrupt }: ComposerProps): React.ReactElement {
  const [text, setText] = useState(() => conversationId ? loadDraft(conversationId) : '')
  const [attachments, setAttachments] = useState<ImageAttachment[]>([])
  const [listening, setListening] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const speechRef = useRef<SpeechRecognitionInstance | null>(null)

  // Restore draft when switching conversations.
  useEffect(() => {
    if (!conversationId) return
    const draft = loadDraft(conversationId)
    setText(draft)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      if (draft) textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`
    }
  }, [conversationId])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    setText(val)
    if (conversationId) saveDraft(conversationId, val)
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
    if (conversationId) saveDraft(conversationId, '')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
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

  const toggleVoice = (): void => {
    if (!SpeechRecognitionClass) return
    if (listening) {
      speechRef.current?.stop()
      return
    }
    const rec = new SpeechRecognitionClass()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = 'en-US'
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const t = e.results[0]?.[0]?.transcript ?? ''
      if (t) {
        setText((prev) => (prev ? `${prev} ${t}` : t))
        if (conversationId) saveDraft(conversationId, text + (text ? ' ' : '') + t)
      }
    }
    rec.onend = () => { setListening(false); speechRef.current = null }
    speechRef.current = rec
    rec.start()
    setListening(true)
  }

  const hasControls = !!caps && (caps.models.length > 0 || caps.controls.length > 0) && !!config && !!onConfigChange

  return (
    <div className="composer">
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
            // Coarse pointers (phones): Enter = newline, Send button submits.
            if (e.key === 'Enter' && !e.shiftKey && !coarsePointer) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Message…"
        />
        <div className="composer-actions">
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
          <span className="composer-spacer" />
          {hasControls ? (
            <ControlPicker caps={caps!} value={config!} onChange={onConfigChange!} />
          ) : null}
          {SpeechRecognitionClass ? (
            <button
              className={`icon-btn${listening ? ' listening' : ''}`}
              data-testid="mic-btn"
              title={listening ? 'Stop recording' : 'Voice input'}
              aria-label={listening ? 'Stop recording' : 'Voice input'}
              onClick={toggleVoice}
            >
              <Icon name="mic" size={18} />
            </button>
          ) : null}
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
