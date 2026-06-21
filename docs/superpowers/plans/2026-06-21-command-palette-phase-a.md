# Command Palette (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/` command palette to the composer that discovers a backend's custom commands, lets the user fill arguments, and resolves them into a ready-to-send message.

**Architecture:** A command is a parameterized prompt template. The backend discovers Claude Code's custom-command files (`.claude/commands/**/*.md`) for a conversation's cwd and returns them over a new cwd-scoped REST endpoint. The frontend opens a mobile-first palette on `/`, and on pick resolves the template (portable subset: `$ARGUMENTS`, `$1..$9`) into the composer textarea for the user to review and send. No change to the send pipeline — a resolved command is an ordinary message.

**Tech Stack:** TypeScript monorepo (pnpm workspaces), `@trux/protocol` shared types, Fastify backend, React + Vite frontend, Vitest + @testing-library/react.

**Deviations from the spec (intentional, code-forced):**
- Discovery is a dedicated cwd-scoped endpoint `GET /commands/discover?agent=&cwd=` (mirrors `/sessions/discover`), **not** a `commands` field on the static `AgentCapabilities` manifest — custom commands live per project and depend on cwd. `AgentCapabilities` is left untouched, so existing fake adapters in tests stay valid.
- "Run" resolves the command **into the composer** for review + manual send, not auto-send (safer for a remote phone).
- The Claude adapter uses `settingSources: []` (`apps/backend/src/adapter/claude.ts:277`), so the SDK never loads custom commands and cannot invoke them verbatim. trux reads and resolves the files itself — the portable subset only. Advanced directives (`!bash`, `@file`, `allowed-tools`) are out of scope and pass through as literal text.

**Run all tests:** `pnpm -r test` · **Typecheck:** `pnpm -r typecheck`

---

## File Structure

- `packages/protocol/src/commands.ts` (create) — `AgentCommand`, `AgentCommandArg`, `CommandsResponse` types + pure `resolveCommand()`.
- `packages/protocol/src/index.ts` (modify) — re-export the above.
- `apps/backend/src/commands.ts` (create) — `discoverClaudeCommands(cwd, home?)`: read/parse command files.
- `apps/backend/src/routes.ts` (modify) — `GET /commands/discover` route.
- `apps/frontend/src/api.ts` (modify) — `discoverCommands(agent, cwd)` client method.
- `apps/frontend/src/components/CommandPalette.tsx` (create) — the palette UI (search, list, arg form).
- `apps/frontend/src/components/Composer.tsx` (modify) — `commands` prop, `/` trigger, insert-on-pick.
- `apps/frontend/src/components/ConversationView.tsx` (modify) — fetch commands, pass to `Composer`.
- `apps/frontend/src/index.css` (modify) — palette bottom-sheet styles.

---

## Task 1: Protocol — command types + `resolveCommand`

**Files:**
- Create: `packages/protocol/src/commands.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/protocol/test/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveCommand, type AgentCommand, type CommandsResponse } from '../src/index'

describe('resolveCommand', () => {
  it('substitutes $ARGUMENTS', () => {
    expect(resolveCommand('Review $ARGUMENTS now', { ARGUMENTS: 'the diff' })).toBe('Review the diff now')
  })
  it('substitutes positional $1..$9', () => {
    expect(resolveCommand('a $1 b $2', { '1': 'x', '2': 'y' })).toBe('a x b y')
  })
  it('resolves missing placeholders to empty string', () => {
    expect(resolveCommand('a $1 $ARGUMENTS', {})).toBe('a  ')
  })
  it('leaves $10 untouched (only $1..$9 are positional)', () => {
    expect(resolveCommand('$10', {})).toBe('$10')
  })
})

describe('command dtos', () => {
  it('builds an AgentCommand and CommandsResponse', () => {
    const cmd: AgentCommand = {
      name: 'review', description: 'Review code', body: 'Review $ARGUMENTS',
      args: [{ name: 'ARGUMENTS', label: 'What to review', required: true }], source: 'file',
    }
    const resp: CommandsResponse = { commands: [cmd] }
    expect(resp.commands[0]?.args[0]?.name).toBe('ARGUMENTS')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @trux/protocol test`
Expected: FAIL — `resolveCommand` / `AgentCommand` not exported.

- [ ] **Step 3: Write minimal implementation**

Create `packages/protocol/src/commands.ts`:

```ts
// A single argument a command declares, surfaced as one field in the palette's
// arg form. `name` is the placeholder token: "ARGUMENTS" or "1".."9".
export interface AgentCommandArg {
  name: string
  label: string
  required: boolean
}

// A discovered, read-only command trux can resolve and run. `body` is the
// template (frontmatter stripped); `name` is the invocation token without slash
// (e.g. "review" or "frontend:component" for a namespaced subfolder).
export interface AgentCommand {
  name: string
  description: string
  body: string
  args: AgentCommandArg[]
  source: 'file'
}

export interface CommandsResponse {
  commands: AgentCommand[]
}

// Resolve a command template against captured args. Portable subset only:
// $ARGUMENTS and positional $1..$9. Unknown placeholders resolve to '' so a
// half-filled form never leaves a literal $1 in the prompt. $10+ is left alone.
export function resolveCommand(body: string, args: Record<string, string>): string {
  return body
    .replace(/\$ARGUMENTS\b/g, () => args.ARGUMENTS ?? '')
    .replace(/\$([1-9])(?![0-9])/g, (_m, d: string) => args[d] ?? '')
}
```

Add to `packages/protocol/src/index.ts` (alongside the existing re-exports):

```ts
export * from './commands'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @trux/protocol test`
Expected: PASS (all four `resolveCommand` cases + dto build).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/commands.ts packages/protocol/src/index.ts packages/protocol/test/commands.test.ts
git commit -m "feat(protocol): command types + resolveCommand"
```

---

## Task 2: Backend — discover Claude command files

**Files:**
- Create: `apps/backend/src/commands.ts`
- Test: `apps/backend/test/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/test/commands.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { discoverClaudeCommands } from '../src/commands'

const dirs: string[] = []
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'trux-cmd-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function writeCmd(root: string, rel: string, content: string): void {
  const full = join(root, '.claude', 'commands', rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, content)
}

describe('discoverClaudeCommands', () => {
  it('parses description, strips frontmatter, and detects $ARGUMENTS', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(cwd, 'review.md', '---\ndescription: Review code\nargument-hint: a PR number\n---\nReview $ARGUMENTS please')
    const cmds = discoverClaudeCommands(cwd, home)
    const review = cmds.find((c) => c.name === 'review')
    expect(review?.description).toBe('Review code')
    expect(review?.body).toBe('Review $ARGUMENTS please')
    expect(review?.args).toEqual([{ name: 'ARGUMENTS', label: 'a PR number', required: true }])
  })

  it('namespaces subfolders with a colon', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(cwd, join('frontend', 'component.md'), 'Make a $1 component')
    const cmds = discoverClaudeCommands(cwd, home)
    const cmd = cmds.find((c) => c.name === 'frontend:component')
    expect(cmd?.args).toEqual([{ name: '1', label: 'Argument 1', required: true }])
  })

  it('falls back to the first non-empty line for description', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(cwd, 'ship.md', '\nShip it to prod\nmore detail')
    expect(discoverClaudeCommands(cwd, home).find((c) => c.name === 'ship')?.description).toBe('Ship it to prod')
  })

  it('lets a project command override a same-named user command', () => {
    const cwd = tmp(); const home = tmp()
    writeCmd(home, 'review.md', 'user version')
    writeCmd(cwd, 'review.md', 'project version')
    expect(discoverClaudeCommands(cwd, home).find((c) => c.name === 'review')?.body).toBe('project version')
  })

  it('returns [] when no commands dir exists', () => {
    expect(discoverClaudeCommands(tmp(), tmp())).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @trux/backend test commands`
Expected: FAIL — cannot find `../src/commands`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/backend/src/commands.ts`:

```ts
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import type { AgentCommand, AgentCommandArg } from '@trux/protocol'

// Recursively collect *.md files under dir (returns [] if dir is absent).
function walkMd(dir: string): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return [] }
  const out: string[] = []
  for (const e of entries) {
    const full = join(dir, e)
    let s: ReturnType<typeof statSync>
    try { s = statSync(full) } catch { continue }
    if (s.isDirectory()) out.push(...walkMd(full))
    else if (e.endsWith('.md')) out.push(full)
  }
  return out
}

// Split optional leading YAML frontmatter (only simple `key: value` lines read).
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  if (!text.startsWith('---\n')) return { meta: {}, body: text }
  const end = text.indexOf('\n---', 4)
  if (end === -1) return { meta: {}, body: text }
  const meta: Record<string, string> = {}
  for (const line of text.slice(4, end).split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    const k = line.slice(0, i).trim()
    const v = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (k) meta[k] = v
  }
  return { meta, body: text.slice(end + 4).replace(/^\n/, '') }
}

// Detect the portable placeholders the palette can prompt for.
function detectArgs(body: string, hint: string): AgentCommandArg[] {
  const args: AgentCommandArg[] = []
  if (/\$ARGUMENTS\b/.test(body)) args.push({ name: 'ARGUMENTS', label: hint || 'Arguments', required: true })
  const positional = new Set<string>()
  for (const m of body.matchAll(/\$([1-9])(?![0-9])/g)) positional.add(m[1])
  for (const d of [...positional].sort()) args.push({ name: d, label: `Argument ${d}`, required: true })
  return args
}

function readDir(dir: string): AgentCommand[] {
  const cmds: AgentCommand[] = []
  for (const file of walkMd(dir)) {
    let raw: string
    try { raw = readFileSync(file, 'utf8') } catch { continue }
    const { meta, body } = parseFrontmatter(raw)
    const name = relative(dir, file).replace(/\.md$/, '').split(sep).join(':')
    const firstLine = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
    cmds.push({
      name,
      description: meta.description || firstLine || name,
      body,
      args: detectArgs(body, meta['argument-hint'] ?? ''),
      source: 'file',
    })
  }
  return cmds
}

// Discover Claude Code custom commands for a cwd: user (~/.claude/commands) then
// project (<cwd>/.claude/commands), with project winning on name collision.
export function discoverClaudeCommands(cwd: string, home = homedir()): AgentCommand[] {
  const byName = new Map<string, AgentCommand>()
  for (const c of readDir(join(home, '.claude', 'commands'))) byName.set(c.name, c)
  for (const c of readDir(join(cwd, '.claude', 'commands'))) byName.set(c.name, c)
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @trux/backend test commands`
Expected: PASS (all five cases).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/commands.ts apps/backend/test/commands.test.ts
git commit -m "feat(backend): discover Claude custom commands"
```

---

## Task 3: Backend — `GET /commands/discover` route

**Files:**
- Modify: `apps/backend/src/routes.ts` (add import near line 8; add route after the `/sessions/discover` block, ~line 129)
- Test: `apps/backend/test/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/backend/test/routes.test.ts` (it already builds a server with `buildServer`; add a `CommandsResponse` import to the protocol import on line 9). Append this describe block:

```ts
import { mkdtempSync as mkdtmp, mkdirSync as mkdir, writeFileSync as writeF } from 'node:fs'
import type { CommandsResponse } from '@trux/protocol'

describe('GET /commands/discover', () => {
  function buildApp(): FastifyInstance {
    const db = openDb(':memory:')
    const registry = new SqliteRegistry(db)
    const manager = new ConversationManager(registry, { claude: new FakeAdapter() })
    return buildServer(baseConfig, registry, manager, [
      { agent: 'claude', models: [], defaultModel: null, controls: [] },
    ])
  }

  it('returns discovered commands for claude', async () => {
    const cwd = mkdtmp(join(tmpdir(), 'trux-route-cmd-'))
    mkdir(join(cwd, '.claude', 'commands'), { recursive: true })
    writeF(join(cwd, '.claude', 'commands', 'review.md'), 'Review $ARGUMENTS')
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: `/commands/discover?agent=claude&cwd=${encodeURIComponent(cwd)}` })
    expect(res.statusCode).toBe(200)
    expect((res.json() as CommandsResponse).commands.some((c) => c.name === 'review')).toBe(true)
    await app.close()
  })

  it('400s when agent or cwd is missing', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/commands/discover?agent=claude' })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns an empty list for a non-claude agent', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/commands/discover?agent=codex&cwd=/tmp' })
    expect((res.json() as CommandsResponse).commands).toEqual([])
    await app.close()
  })
})
```

> Note: match the exact `buildServer(...)` signature already used elsewhere in this test file — copy the call shape from the nearest existing `buildServer(` usage rather than the illustrative one above if it differs.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @trux/backend test routes`
Expected: FAIL — `/commands/discover` returns 404.

- [ ] **Step 3: Write minimal implementation**

In `apps/backend/src/routes.ts`, add the import (top of file, near line 8):

```ts
import { discoverClaudeCommands } from './commands'
```

Add the route immediately after the `/sessions/discover` handler (after line 129):

```ts
app.get('/commands/discover', async (req, reply) => {
  const { agent, cwd } = req.query as { agent?: string; cwd?: string }
  if (!agent || !cwd) return reply.code(400).send({ error: 'agent and cwd are required' })
  if (agent === 'claude') return { commands: discoverClaudeCommands(cwd) }
  return { commands: [] }
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @trux/backend test routes`
Expected: PASS (3 new cases) and the existing route tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/routes.ts apps/backend/test/routes.test.ts
git commit -m "feat(backend): GET /commands/discover endpoint"
```

---

## Task 4: Frontend — `CommandPalette` component

**Files:**
- Create: `apps/frontend/src/components/CommandPalette.tsx`
- Test: `apps/frontend/test/CommandPalette.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/test/CommandPalette.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AgentCommand } from '@trux/protocol'
import { CommandPalette } from '../src/components/CommandPalette'

afterEach(cleanup)

const cmds: AgentCommand[] = [
  { name: 'ship', description: 'Ship to prod', body: 'Ship it now', args: [], source: 'file' },
  { name: 'review', description: 'Review code', body: 'Review $ARGUMENTS', args: [{ name: 'ARGUMENTS', label: 'What', required: true }], source: 'file' },
]

describe('CommandPalette', () => {
  it('lists commands and filters by query', () => {
    render(<CommandPalette agent="claude" commands={cmds} onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('command-ship')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('command-search'), { target: { value: 'rev' } })
    expect(screen.queryByTestId('command-ship')).toBeNull()
    expect(screen.getByTestId('command-review')).toBeInTheDocument()
  })

  it('picks a no-arg command immediately with its resolved body', () => {
    const onPick = vi.fn(); const onClose = vi.fn()
    render(<CommandPalette agent="claude" commands={cmds} onPick={onPick} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('command-ship'))
    expect(onPick).toHaveBeenCalledWith('Ship it now')
    expect(onClose).toHaveBeenCalled()
  })

  it('shows an arg form and resolves with the entered value', () => {
    const onPick = vi.fn()
    render(<CommandPalette agent="claude" commands={cmds} onPick={onPick} onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('command-review'))
    fireEvent.change(screen.getByTestId('arg-ARGUMENTS'), { target: { value: 'the diff' } })
    fireEvent.click(screen.getByTestId('command-run'))
    expect(onPick).toHaveBeenCalledWith('Review the diff')
  })

  it('renders an empty state when there are no commands', () => {
    render(<CommandPalette agent="claude" commands={[]} onPick={() => {}} onClose={() => {}} />)
    expect(screen.getByTestId('command-empty')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @trux/frontend test CommandPalette`
Expected: FAIL — cannot find `../src/components/CommandPalette`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/frontend/src/components/CommandPalette.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @trux/frontend test CommandPalette`
Expected: PASS (4 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/CommandPalette.tsx apps/frontend/test/CommandPalette.test.tsx
git commit -m "feat(frontend): CommandPalette component"
```

---

## Task 5: Frontend — wire the palette into the Composer

**Files:**
- Modify: `apps/frontend/src/components/Composer.tsx`
- Test: `apps/frontend/test/components.test.tsx` (the `describe('Composer', …)` block)

- [ ] **Step 1: Write the failing test**

Add to the `describe('Composer', …)` block in `apps/frontend/test/components.test.tsx` (add a `CommandPalette`-driving test; `AgentCommand` import from `@trux/protocol`, and `waitFor` is already imported):

```tsx
it('opens the palette when "/" is typed on an empty box and inserts a picked command', () => {
  const onSend = vi.fn()
  const commands = [
    { name: 'ship', description: 'Ship it', body: 'Ship to prod', args: [], source: 'file' as const },
  ]
  render(
    <Composer
      busy={false}
      onSend={onSend}
      onInterrupt={() => {}}
      caps={{ agent: 'claude', models: [], defaultModel: null, controls: [] }}
      commands={commands}
    />,
  )
  const input = screen.getByTestId('composer-input') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: '/' } })
  expect(screen.getByTestId('command-palette')).toBeInTheDocument()
  fireEvent.click(screen.getByTestId('command-ship'))
  expect(input.value).toBe('Ship to prod')
  expect(screen.queryByTestId('command-palette')).toBeNull()
})

it('does not open the palette for "/" typed mid-text', () => {
  render(<Composer busy={false} onSend={() => {}} onInterrupt={() => {}} commands={[]} />)
  const input = screen.getByTestId('composer-input') as HTMLTextAreaElement
  fireEvent.change(input, { target: { value: 'path/to' } })
  expect(screen.queryByTestId('command-palette')).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @trux/frontend test components`
Expected: FAIL — `commands` prop unknown / no `command-palette`.

- [ ] **Step 3: Write minimal implementation**

In `apps/frontend/src/components/Composer.tsx`:

Add imports at the top:

```ts
import type { AgentCapabilities, AgentCommand, ImageAttachment, TurnConfig } from '@trux/protocol'
import { CommandPalette } from './CommandPalette'
```

(Replace the existing `import type { AgentCapabilities, ImageAttachment, TurnConfig } …` line with the one above. `ControlPicker` import stays.)

Add `commands` to `ComposerProps`:

```ts
interface ComposerProps {
  conversationId?: string
  busy: boolean
  caps?: AgentCapabilities
  commands?: AgentCommand[]
  config?: TurnConfig
  onConfigChange?: (next: TurnConfig) => void
  onSend: (text: string, attachments?: ImageAttachment[]) => void
  onInterrupt: () => void
}
```

Add `commands` to the destructured params and a palette state hook (next to the other `useState`s, ~line 73):

```ts
export function Composer({ conversationId, busy, caps, commands, config, onConfigChange, onSend, onInterrupt }: ComposerProps): React.ReactElement {
  const [text, setText] = useState(() => conversationId ? loadDraft(conversationId) : '')
  const [paletteOpen, setPaletteOpen] = useState(false)
```

In `handleChange`, open the palette when the box becomes exactly `/` (clear the slash so the inserted text stays clean):

```ts
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const val = e.target.value
    if (val === '/' && commands && commands.length > 0) {
      setPaletteOpen(true)
      setText('')
      if (conversationId) saveDraft(conversationId, '')
      e.target.style.height = 'auto'
      return
    }
    setText(val)
    if (conversationId) saveDraft(conversationId, val)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }
```

Add an insert handler (place it near `submit`):

```ts
  const insertFromCommand = (resolved: string): void => {
    setText(resolved)
    if (conversationId) saveDraft(conversationId, resolved)
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
      el.focus()
    }
  }
```

Render the palette at the top of the returned `<div className="composer">` (before `attachment-previews`):

```tsx
  return (
    <div className="composer">
      {paletteOpen && commands ? (
        <CommandPalette
          agent={caps?.agent ?? 'agent'}
          commands={commands}
          onPick={insertFromCommand}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
      {attachments.length > 0 && (
```

Add a discoverability button in `composer-actions`, right after the attach button (only when commands exist):

```tsx
          {commands && commands.length > 0 ? (
            <button
              className="icon-btn"
              data-testid="cmd-btn"
              title="Commands"
              aria-label="Commands"
              onClick={() => setPaletteOpen(true)}
            >/</button>
          ) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @trux/frontend test components`
Expected: PASS (both new cases) and the existing Composer tests stay green.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/Composer.tsx apps/frontend/test/components.test.tsx
git commit -m "feat(frontend): open command palette from the composer"
```

---

## Task 6: Frontend — fetch commands in ConversationView

**Files:**
- Modify: `apps/frontend/src/api.ts`, `apps/frontend/src/components/ConversationView.tsx`
- Test: `apps/frontend/test/ConversationView.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `apps/frontend/test/ConversationView.test.tsx` (it already mocks `api`; mirror how `listAgents` is mocked there). Add a test asserting the command button appears once commands load:

```tsx
it('fetches commands for the conversation and shows the command button', async () => {
  vi.spyOn(api, 'discoverCommands').mockResolvedValue({
    commands: [{ name: 'ship', description: 'Ship', body: 'Ship it', args: [], source: 'file' }],
  })
  // ...render ConversationView with a seeded conversation (follow the existing
  // setup in this file: seed the store's `conversations` with a claude conv, then
  // render <ConversationView id={...} />)...
  expect(await screen.findByTestId('cmd-btn')).toBeInTheDocument()
  expect(api.discoverCommands).toHaveBeenCalledWith('claude', expect.any(String))
})
```

> Reuse the exact store-seeding + render helper already used by the other tests in `ConversationView.test.tsx`; only the `discoverCommands` mock and the two assertions above are new.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @trux/frontend test ConversationView`
Expected: FAIL — `api.discoverCommands` is not a function.

- [ ] **Step 3: Write minimal implementation**

In `apps/frontend/src/api.ts`, add `CommandsResponse` to the type import block and add the method inside the `api` object (after `discoverSessions`):

```ts
  discoverCommands: (agent: string, cwd: string) =>
    fetch(`/commands/discover?agent=${encodeURIComponent(agent)}&cwd=${encodeURIComponent(cwd)}`, {
      headers: authHeaders(),
    }).then(json<CommandsResponse>),
```

In `apps/frontend/src/components/ConversationView.tsx`:

Add `AgentCommand` to the protocol type import (line 2). Add state + fetch near the existing agents fetch (after line 91):

```ts
  const [commands, setCommands] = useState<AgentCommand[]>([])
  useEffect(() => {
    if (!conv) return
    void api.discoverCommands(conv.agent, conv.cwd).then((r) => setCommands(r.commands ?? [])).catch(() => {})
  }, [conv?.agent, conv?.cwd])
```

Pass it to the `Composer` (in the JSX at the bottom, add the prop):

```tsx
      <Composer
        conversationId={id}
        busy={busy}
        caps={caps}
        commands={commands}
        config={config}
        onConfigChange={setConfig}
        onSend={onSend}
        onInterrupt={() => {
          getConnection(id)?.interrupt()
          haptic('medium')
        }}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @trux/frontend test ConversationView`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/api.ts apps/frontend/src/components/ConversationView.tsx apps/frontend/test/ConversationView.test.tsx
git commit -m "feat(frontend): load commands per conversation"
```

---

## Task 7: Frontend — palette styling (mobile bottom sheet)

**Files:**
- Modify: `apps/frontend/src/index.css`

- [ ] **Step 1: Add styles**

Append to `apps/frontend/src/index.css` (match existing variable names/tokens already used in the file for colours and radius; the values below are a starting point — align them with the surrounding theme variables):

```css
/* Command palette: a bottom sheet anchored to the composer, mobile-first. */
.command-palette { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; justify-content: flex-end; }
.command-scrim { position: absolute; inset: 0; background: rgba(0,0,0,0.4); border: 0; }
.command-sheet {
  position: relative; max-height: 60vh; overflow-y: auto;
  background: var(--surface, #1b1b1f); border-top-left-radius: 16px; border-top-right-radius: 16px;
  padding: 12px; box-shadow: 0 -8px 24px rgba(0,0,0,0.3);
}
.command-search { width: 100%; padding: 12px; font-size: 16px; border-radius: 10px; border: 1px solid var(--border, #333); background: var(--input, #111); color: inherit; }
.command-section-label { text-transform: uppercase; font-size: 11px; opacity: 0.6; margin: 12px 4px 4px; }
.command-list { list-style: none; margin: 0; padding: 0; }
.command-item { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 12px; min-height: 48px; border: 0; background: transparent; color: inherit; border-radius: 10px; }
.command-item:active { background: var(--hover, #2a2a30); }
.command-name { font-weight: 600; }
.command-desc { font-size: 13px; opacity: 0.7; }
.command-empty { padding: 16px; opacity: 0.6; text-align: center; }
.command-args { display: flex; flex-direction: column; gap: 12px; }
.command-args-title { font-weight: 600; }
.command-arg { display: flex; flex-direction: column; gap: 4px; }
.command-arg input { padding: 12px; font-size: 16px; border-radius: 10px; border: 1px solid var(--border, #333); background: var(--input, #111); color: inherit; }
.command-run { padding: 12px; min-height: 48px; border-radius: 10px; border: 0; background: var(--accent, #4f7cff); color: #fff; font-weight: 600; }
```

- [ ] **Step 2: Commit**

```bash
git add apps/frontend/src/index.css
git commit -m "style(frontend): command palette bottom sheet"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm -r test`
Expected: all packages green, including the pre-existing suites (protocol, backend, frontend).

- [ ] **Step 2: Typecheck**

Run: `pnpm -r typecheck`
Expected: no errors.

- [ ] **Step 3: Manual mobile check (per the project's mobile-UX standard)**

Start the app (`pnpm dev`), open a conversation in a repo that has at least one `.claude/commands/*.md` file, and at a 390px viewport: type `/` in the composer → the bottom sheet slides up with the command list; pick a no-arg command → its text lands in the composer; pick an arg command → fill the field → Insert → resolved text lands in the composer. Capture a screenshot of the open palette at 390px and confirm tap targets are ≥44px and nothing overflows horizontally. (Use the `playwright` skill to drive this if running headless.)

- [ ] **Step 4: Commit any styling fixes from the manual check, then stop for review.**

```bash
git add -A && git commit -m "fix(frontend): command palette mobile polish"   # only if changes were needed
```

---

## Self-Review (completed during planning)

- **Spec coverage:** `/` trigger (Task 5), native discovery (Tasks 2–3), run/resolve (Tasks 1, 4–5), labelled agent section (Task 4), mobile bottom sheet + arg form + recents-first + escape hatch via scrim/close (Tasks 4, 7). Phase-B-only items (workflow store, authoring, import) are intentionally absent.
- **Type consistency:** `AgentCommand` / `AgentCommandArg` / `CommandsResponse` / `resolveCommand` are defined once in Task 1 and used unchanged in Tasks 2–6; `discoverClaudeCommands(cwd, home?)` signature matches between Task 2 (impl) and Task 3 (route); `api.discoverCommands(agent, cwd)` matches its call in Task 6.
- **Placeholder scan:** no TBD/“handle edge cases”; every code step carries complete code. The two test steps that reference existing in-file setup (Task 3 `buildServer` shape, Task 6 store seeding) point to the concrete existing pattern to copy rather than leaving logic unspecified.
