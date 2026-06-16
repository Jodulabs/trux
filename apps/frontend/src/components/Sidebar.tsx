import { useState } from 'react'
import type { Conversation } from '@trux/protocol'
import { NewConversationDialog } from './NewConversationDialog'
import { PairModal } from './PairModal'
import { Icon } from './Icon'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onCreated: (id: string) => void
}

// Last path segment of the cwd, so the list reads as repo names not full paths.
function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

export function Sidebar({ conversations, currentId, onSelect, onCreated }: Props): React.ReactElement {
  const [pairing, setPairing] = useState(false)
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
      <button className="pair-button" data-testid="pair-open" onClick={() => setPairing(true)}>
        <Icon name="phone" size={16} /> Pair phone
      </button>
      {pairing && <PairModal onClose={() => setPairing(false)} />}
    </aside>
  )
}
