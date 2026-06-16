import { useState } from 'react'
import type { Conversation } from '@trux/protocol'
import { NewConversationDialog } from './NewConversationDialog'
import { PairModal } from './PairModal'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onCreated: (id: string) => void
}

const DOT: Record<string, string> = {
  idle: '⚪', thinking: '🟡', awaiting_approval: '🔵', error: '🔴',
}

export function Sidebar({ conversations, currentId, onSelect, onCreated }: Props): React.ReactElement {
  const [pairing, setPairing] = useState(false)
  return (
    <aside className="sidebar">
      <NewConversationDialog onCreated={onCreated} />
      <ul data-testid="conversation-list">
        {conversations.map((c) => (
          <li
            key={c.id}
            className={c.id === currentId ? 'active' : ''}
            onClick={() => onSelect(c.id)}
          >
            <span className="badge">{c.agent}</span> {DOT[c.status] ?? '⚪'}{' '}
            {c.title ?? c.cwd}
          </li>
        ))}
      </ul>
      <button className="pair-button" data-testid="pair-open" onClick={() => setPairing(true)}>
        📱 Pair phone
      </button>
      {pairing && <PairModal onClose={() => setPairing(false)} />}
    </aside>
  )
}
