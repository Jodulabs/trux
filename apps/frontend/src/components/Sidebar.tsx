import { useState } from 'react'
import type { Conversation } from '@trux/protocol'
import { NewConversationDialog } from './NewConversationDialog'
import { PairModal } from './PairModal'
import { useStore } from '../store'
import { Icon } from './Icon'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onCreated: (id: string) => void
}

// Pairing is a desktop→phone handoff (the big screen shows a QR the phone scans),
// so the button is pure noise on the phone where you're already paired. Show it
// only on a fine pointer (mouse) — i.e. the desktop.
const finePointer =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches

// Last path segment of the cwd, so the list reads as repo names not full paths.
function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

export function Sidebar({ conversations, currentId, onSelect, onCreated }: Props): React.ReactElement {
  const [pairing, setPairing] = useState(false)
  const tailscaleHost = useStore((s) => s.tailscaleHost)
  // Only useful on the desktop, and only when pairing can actually produce a QR:
  // it needs both the tailnet host and a token (PairModal gates the QR on both).
  const hasToken = Boolean(localStorage.getItem('trux_token'))
  const canPair = finePointer && Boolean(tailscaleHost) && hasToken
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="mark">▰</span> trux
        <span className="sub">· agent console</span>
      </div>
      <NewConversationDialog onCreated={onCreated} />
      <ul className="conversation-list" data-testid="conversation-list">
        {conversations.map((c) => (
          <li
            key={c.id}
            className={c.id === currentId ? 'active' : ''}
            onClick={() => onSelect(c.id)}
          >
            <span className={`dot ${c.status}`} />
            <span className="title">{c.title ?? shortCwd(c.cwd)}</span>
            <span className="badge">{c.agent}</span>
          </li>
        ))}
      </ul>
      {canPair && (
        <button className="pair-button" data-testid="pair-open" onClick={() => setPairing(true)}>
          <Icon name="phone" size={16} /> Pair phone
        </button>
      )}
      {pairing && <PairModal onClose={() => setPairing(false)} />}
    </aside>
  )
}
