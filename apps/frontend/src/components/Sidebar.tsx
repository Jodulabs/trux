import { useEffect, useRef, useState } from 'react'
import type { Conversation } from '@trux/protocol'
import { NewConversationDialog } from './NewConversationDialog'
import { PairModal } from './PairModal'
import { useStore } from '../store'
import { api } from '../api'
import { Icon } from './Icon'

function hasDraft(id: string): boolean {
  try { return Boolean(localStorage.getItem(`trux-draft-${id}`)) } catch { return false }
}

interface Props {
  conversations: Conversation[]
  currentId: string | null
  onSelect: (id: string) => void
  onCreated: (id: string) => void
}

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

// Pairing is a desktop→phone handoff (the big screen shows a QR the phone scans),
// so the button is pure noise on the phone where you're already paired. Show it
// only on a fine pointer (mouse) — i.e. the desktop.
const finePointer =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: fine)').matches

export function Sidebar({ conversations, currentId, onSelect, onCreated }: Props): React.ReactElement {
  const [pairing, setPairing] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tailscaleHost = useStore((s) => s.tailscaleHost)
  const convMeta = useStore((s) => s.convMeta)

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!searchQ.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(() => {
      api.searchConversations(searchQ.trim()).then(setSearchResults).catch(() => setSearchResults(null))
    }, 250)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [searchQ])

  const displayList = searchResults ?? conversations
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
      <div className="sidebar-search">
        <input
          className="sidebar-search-input"
          data-testid="sidebar-search"
          type="search"
          placeholder="Search conversations…"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setSearchQ('') }}
          aria-label="Search conversations"
        />
      </div>
      <ul className="conversation-list" data-testid="conversation-list">
        {displayList.map((c) => {
          // Prefer live status from the connection manager; fall back to the REST snapshot.
          const liveStatus = convMeta[c.id]?.status ?? c.status
          const unread = convMeta[c.id]?.unread ?? 0
          return (
            <li
              key={c.id}
              className={c.id === currentId ? 'active' : ''}
              onClick={() => onSelect(c.id)}
            >
              <span className={`dot ${liveStatus}`} />
              <span className="title">{c.title ?? shortCwd(c.cwd)}</span>
              {unread > 0 && c.id !== currentId ? (
                <span className="unread-badge" data-testid="unread-badge">{unread}</span>
              ) : null}
              {hasDraft(c.id) ? (
                <span className="draft-badge" data-testid="draft-badge" title="Unsent draft">✏</span>
              ) : null}
              {(convMeta[c.id]?.totalCost ?? 0) > 0 ? (
                <span className="cost-mini" data-testid="cost-mini">${(convMeta[c.id]!.totalCost).toFixed(2)}</span>
              ) : null}
              <span className="badge">{c.agent}</span>
            </li>
          )
        })}
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
