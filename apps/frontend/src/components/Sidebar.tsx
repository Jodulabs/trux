import type { Conversation } from '@trux/protocol'
import { NewConversationDialog } from './NewConversationDialog'

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
    </aside>
  )
}
