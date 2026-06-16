import { useEffect, useState } from 'react'
import type { Workspace } from '@trux/protocol'
import { api } from '../api'

interface Props {
  onCreated: (id: string) => void
}

export function NewConversationDialog({ onCreated }: Props): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [cwd, setCwd] = useState('')

  useEffect(() => {
    void api.listWorkspaces().then((ws) => {
      setWorkspaces(ws)
      const first = ws[0]?.worktrees[0]?.path ?? ''
      setCwd(first)
    })
  }, [])

  const create = async (): Promise<void> => {
    if (!cwd) return
    const conv = await api.createConversation({ agent: 'claude', cwd })
    onCreated(conv.id)
  }

  return (
    <div className="new-conversation">
      <select data-testid="cwd-select" value={cwd} onChange={(e) => setCwd(e.target.value)}>
        {workspaces.flatMap((w) =>
          w.worktrees.map((t) => (
            <option key={t.path} value={t.path}>
              {t.path}{t.branch ? ` (${t.branch})` : ''}
            </option>
          )),
        )}
      </select>
      <button data-testid="create" onClick={() => void create()}>New claude conversation</button>
    </div>
  )
}
