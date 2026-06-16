import { useEffect, useState } from 'react'
import type { AgentName, Workspace } from '@trux/protocol'
import { api } from '../api'

interface Props {
  onCreated: (id: string) => void
}

export function NewConversationDialog({ onCreated }: Props): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<AgentName[]>([])
  const [cwd, setCwd] = useState('')
  const [agent, setAgent] = useState<AgentName>('claude')

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

  const create = async (): Promise<void> => {
    if (!cwd) return
    const conv = await api.createConversation({ agent, cwd })
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
      <button data-testid="create" onClick={() => void create()}>New conversation</button>
    </div>
  )
}
