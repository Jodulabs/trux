import { useState } from 'react'
import type { AgentCommand } from '@trux/protocol'
import { resolveCommand } from '@trux/protocol'

interface Props {
  agent: string
  commands: AgentCommand[]
  onPick: (text: string) => void
  onClose: () => void
}

const RECENTS_KEY = 'trux-cmd-recents'
function loadRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as string[] } catch { return [] }
}
function pushRecent(name: string): void {
  const next = [name, ...loadRecents().filter((n) => n !== name)].slice(0, 8)
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(next)) } catch {}
}

export function CommandPalette({ agent, commands, onPick, onClose }: Props): React.ReactElement {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AgentCommand | null>(null)
  const [argv, setArgv] = useState<Record<string, string>>({})

  const recents = loadRecents()
  const q = query.toLowerCase()
  const filtered = commands
    .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
    .sort((a, b) => {
      const wa = recents.indexOf(a.name), wb = recents.indexOf(b.name)
      return (wa === -1 ? Infinity : wa) - (wb === -1 ? Infinity : wb) || a.name.localeCompare(b.name)
    })

  const run = (cmd: AgentCommand, values: Record<string, string>): void => {
    pushRecent(cmd.name)
    onPick(resolveCommand(cmd.body, values))
    onClose()
  }
  const choose = (cmd: AgentCommand): void => {
    if (cmd.args.length === 0) run(cmd, {})
    else { setSelected(cmd); setArgv({}) }
  }

  return (
    <div className="command-palette" data-testid="command-palette">
      <button className="command-scrim" aria-label="Close commands" onClick={onClose} />
      <div className="command-sheet" role="dialog" aria-label="Commands">
        {selected ? (
          <div className="command-args" data-testid="command-args">
            <div className="command-args-title">/{selected.name}</div>
            {selected.args.map((a, i) => (
              <label key={a.name} className="command-arg">
                <span>{a.label}</span>
                <input
                  data-testid={`arg-${a.name}`}
                  autoFocus={i === 0}
                  value={argv[a.name] ?? ''}
                  onChange={(e) => setArgv((p) => ({ ...p, [a.name]: e.target.value }))}
                />
              </label>
            ))}
            <button className="command-run" data-testid="command-run" onClick={() => run(selected, argv)}>Insert</button>
          </div>
        ) : (
          <>
            <input
              className="command-search"
              data-testid="command-search"
              placeholder="Search commands…"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="command-section-label">{agent} commands</div>
            {filtered.length === 0 ? (
              <div className="command-empty" data-testid="command-empty">No commands</div>
            ) : (
              <ul className="command-list">
                {filtered.map((c) => (
                  <li key={c.name}>
                    <button className="command-item" data-testid={`command-${c.name}`} onClick={() => choose(c)}>
                      <span className="command-name">/{c.name}</span>
                      <span className="command-desc">{c.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}
