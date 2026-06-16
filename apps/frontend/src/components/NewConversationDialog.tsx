import { useEffect, useState } from 'react'
import type { AgentName, DiscoveredSession, Workspace } from '@trux/protocol'
import { api } from '../api'

interface Props {
  onCreated: (id: string) => void
}

function formatSession(s: DiscoveredSession): string {
  const date = new Date(s.updatedAt).toLocaleString()
  return `${date}  (${s.sessionId.slice(0, 8)}…)`
}

export function NewConversationDialog({ onCreated }: Props): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<AgentName[]>([])
  const [cwd, setCwd] = useState('')
  const [agent, setAgent] = useState<AgentName>('claude')
  const [sessions, setSessions] = useState<DiscoveredSession[]>([])
  const [sessionId, setSessionId] = useState('')

  useEffect(() => {
    void api.listWorkspaces().then((ws) => {
      setWorkspaces(ws)
      setCwd(ws[0]?.worktrees[0]?.path ?? '')
    })
    void api.listAgents().then((r) => {
      const list = r.agents ?? []
      setAgents(list)
      if (list[0]) setAgent(list[0])
    })
  }, [])

  // Re-discover sessions whenever agent or cwd changes.
  useEffect(() => {
    if (!cwd || !agent) return
    setSessions([])
    setSessionId('')
    void api.discoverSessions(agent, cwd).then(setSessions).catch(() => setSessions([]))
  }, [agent, cwd])

  const create = async (): Promise<void> => {
    if (!cwd) return
    const conv = await api.createConversation({
      agent,
      cwd,
      native_session_id: sessionId || undefined,
    })
    onCreated(conv.id)
  }

  return (
    <div className="new-conversation">
      <select data-testid="agent-select" value={agent} onChange={(e) => setAgent(e.target.value as AgentName)}>
        {agents.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>
      <select data-testid="cwd-select" value={cwd} onChange={(e) => setCwd(e.target.value)}>
        {workspaces.flatMap((w) =>
          w.worktrees.map((t) => (
            <option key={t.path} value={t.path}>
              {t.path}{t.branch ? ` (${t.branch})` : ''}
            </option>
          )),
        )}
      </select>
      {sessions.length > 0 && (
        <select data-testid="session-select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
          <option value="">— new session —</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>{formatSession(s)}</option>
          ))}
        </select>
      )}
      <button data-testid="create" onClick={() => void create()}>New conversation</button>
    </div>
  )
}
