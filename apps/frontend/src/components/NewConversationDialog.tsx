import { useEffect, useMemo, useState } from 'react'
import type { AgentCapabilities, AgentName, DiscoveredSession, Workspace } from '@trux/protocol'
import { api } from '@trux/client/api'
import { useStore } from '@trux/client/store'

interface Props {
  onCreated: (id: string) => void
}

// A single selectable destination: one git worktree of one project (repo).
interface FolderEntry {
  project: string
  root: string
  path: string
  branch: string | null
  multi: boolean
}

function basename(path: string): string {
  const p = path.replace(/\/$/, '').split('/').pop()
  return p || path
}

function formatSession(s: DiscoveredSession): string {
  const date = new Date(s.updatedAt).toLocaleString()
  return `${date}  (${s.sessionId.slice(0, 8)}…)`
}

export function NewConversationDialog({ onCreated }: Props): React.ReactElement {
  const conversations = useStore((s) => s.conversations)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<AgentCapabilities[]>([])
  const [agent, setAgent] = useState<AgentName>('claude')
  const [cwd, setCwd] = useState('')
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState<DiscoveredSession[]>([])
  const [sessionId, setSessionId] = useState('')

  useEffect(() => {
    void api.listWorkspaces().then(setWorkspaces)
    void api.listAgents().then((r) => {
      const list = r.agents ?? []
      setAgents(list)
      if (list[0]) setAgent(list[0].agent)
    })
  }, [])

  // Every selectable folder, flattened from project → worktree, in project order.
  const folders = useMemo<FolderEntry[]>(
    () =>
      workspaces.flatMap((w) =>
        w.worktrees.map((t) => ({
          project: w.name,
          root: w.root,
          path: t.path,
          branch: t.branch,
          multi: w.worktrees.length > 1,
        })),
      ),
    [workspaces],
  )
  const byPath = useMemo(() => new Map(folders.map((f) => [f.path, f])), [folders])

  // Recent destinations come from past conversations (most-recent cwd first),
  // so the common case — "the folder I was just in" — is one tap, not a hunt.
  const recents = useMemo<FolderEntry[]>(() => {
    const seen = new Set<string>()
    const out: FolderEntry[] = []
    for (const c of [...conversations].sort((a, b) => b.updated_at - a.updated_at)) {
      if (seen.has(c.cwd)) continue
      seen.add(c.cwd)
      out.push(
        byPath.get(c.cwd) ?? { project: basename(c.cwd), root: c.cwd, path: c.cwd, branch: null, multi: false },
      )
      if (out.length >= 5) break
    }
    return out
  }, [conversations, byPath])

  // Default to the most recent folder, else the first project's first worktree.
  useEffect(() => {
    if (cwd) return
    const first = recents[0]?.path ?? folders[0]?.path ?? ''
    if (first) setCwd(first)
  }, [recents, folders, cwd])

  // Re-discover resumable sessions whenever the agent or folder changes.
  useEffect(() => {
    if (!cwd || !agent) return
    setSessions([])
    setSessionId('')
    void api.discoverSessions(agent, cwd).then(setSessions).catch(() => setSessions([]))
  }, [agent, cwd])

  const q = query.trim().toLowerCase()
  const matches = (f: FolderEntry): boolean =>
    !q ||
    f.project.toLowerCase().includes(q) ||
    f.path.toLowerCase().includes(q) ||
    (f.branch?.toLowerCase().includes(q) ?? false)

  const filteredRecents = q ? recents.filter(matches) : recents

  // Group filtered folders by project, preserving project order, for nested display.
  const groups = useMemo(() => {
    const map = new Map<string, FolderEntry[]>()
    for (const f of folders) {
      if (!matches(f)) continue
      const arr = map.get(f.root) ?? []
      arr.push(f)
      map.set(f.root, arr)
    }
    return [...map.values()]
  }, [folders, q])

  const create = async (): Promise<void> => {
    if (!cwd) return
    const conv = await api.createConversation({
      agent,
      cwd,
      native_session_id: sessionId || undefined,
      model: null,
      options: {},
    })
    onCreated(conv.id)
  }

  // A plain render helper, not a nested component — a nested component is a new
  // type on every render, so React would remount the rows and drop clicks.
  const renderRow = (f: FolderEntry, primary: string, key: string): React.ReactElement => (
    <button
      key={key}
      type="button"
      className={`folder-row${cwd === f.path ? ' selected' : ''}`}
      data-testid={`folder-${f.path}`}
      onClick={() => setCwd(f.path)}
    >
      <span className="folder-name">{primary}</span>
      <span className="folder-meta">{f.path}</span>
    </button>
  )

  return (
    <div className="start-panel" data-testid="new-conversation">
      <div className="folder-picker">
        <input
          className="folder-search"
          data-testid="folder-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects and folders…"
        />
        <div className="folder-list" data-testid="folder-list">
          {filteredRecents.length > 0 && (
            <>
              <div className="folder-section">Recent</div>
              {filteredRecents.map((f) => renderRow(f, f.branch ? `${f.project} · ${f.branch}` : f.project, `recent-${f.path}`))}
            </>
          )}
          {groups.length > 0 && (
            <>
              <div className="folder-section">Projects</div>
              {groups.map((items) => {
                const head = items[0]
                if (!head.multi) {
                  return renderRow(head, head.branch ? `${head.project} · ${head.branch}` : head.project, head.root)
                }
                return (
                  <div key={head.root} className="folder-group">
                    <div className="folder-group-label">{head.project}</div>
                    {items.map((f) => renderRow(f, f.branch ?? basename(f.path), f.path))}
                  </div>
                )
              })}
            </>
          )}
          {filteredRecents.length === 0 && groups.length === 0 && (
            <p className="folder-empty">{q ? 'No matching folders.' : 'No projects configured.'}</p>
          )}
        </div>
      </div>

      <div className="start-controls">
        {agents.length > 1 && (
          <select data-testid="agent-select" value={agent} onChange={(e) => setAgent(e.target.value as AgentName)}>
            {agents.map((a) => (
              <option key={a.agent} value={a.agent}>{a.agent}</option>
            ))}
          </select>
        )}
        {sessions.length > 0 && (
          <select data-testid="session-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
            <option value="">— new session —</option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>{formatSession(s)}</option>
            ))}
          </select>
        )}
        <button className="create" data-testid="create" disabled={!cwd} onClick={() => void create()}>
          + New conversation
        </button>
      </div>
    </div>
  )
}
