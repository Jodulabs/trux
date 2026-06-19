import type { Conversation } from '@trux/protocol'
import { useStore } from '../store'

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
}

function shortTitle(c: Conversation): string {
  if (c.title) return c.title.slice(0, 18)
  const parts = c.cwd.replace(/\/$/, '').split('/')
  return (parts[parts.length - 1] || c.cwd).slice(0, 18)
}

// Bottom-anchored thumb-zone switcher for mobile. Only renders on coarse-pointer
// (touch) devices. Shows at most 5 conversations so it fits a phone screen width.
export function QuickSwitcher({ conversations, currentId, onSelect }: Props): React.ReactElement | null {
  const convMeta = useStore((s) => s.convMeta)

  // Show at most 5; prioritise unread/active, then recency (conversations are
  // ordered newest-first from the API).
  const visible = conversations.slice(0, 5)
  if (visible.length === 0) return null

  return (
    <nav className="quick-switcher" data-testid="quick-switcher" aria-label="Quick conversation switcher">
      {visible.map((c) => {
        const liveStatus = convMeta[c.id]?.status ?? c.status
        const unread = convMeta[c.id]?.unread ?? 0
        const active = c.id === currentId
        return (
          <button
            key={c.id}
            className={`qs-item${active ? ' active' : ''}`}
            data-testid="qs-item"
            onClick={() => onSelect(c.id)}
            aria-current={active ? 'true' : undefined}
          >
            <span className={`dot ${liveStatus}`} />
            <span className="qs-title">{shortTitle(c)}</span>
            {unread > 0 && !active ? (
              <span className="qs-unread" data-testid="qs-unread">{unread > 9 ? '9+' : unread}</span>
            ) : null}
          </button>
        )
      })}
    </nav>
  )
}
