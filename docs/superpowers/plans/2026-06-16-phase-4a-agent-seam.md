# Phase 4a — Agent Factory + Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Checkbox (`- [ ]`) steps.

**Goal:** Select an `AgentAdapter` per conversation by agent name; expose available agents; add a new-conversation agent picker.

**Architecture:** Replace the manager's single adapter with `Map<AgentName, AgentAdapter>`. Add `GET /agents`. Frontend picker reads it.

**Spec:** `docs/superpowers/specs/2026-06-16-phase-4a-agent-seam-design.md`.

---

## Task 1: Protocol — AgentsResponse

**Files:** Modify `packages/protocol/src/rest.ts`; Test `packages/protocol/test/rest.test.ts`.

- [ ] **Step 1: Add to `packages/protocol/src/rest.ts`** (after `ConversationDetail`)

```ts
export interface AgentsResponse {
  agents: AgentName[]
}
```

- [ ] **Step 2: Append test to `packages/protocol/test/rest.test.ts`**

Add `AgentsResponse` to the type import, then:

```ts
describe('agents response', () => {
  it('lists agent names', () => {
    const r: AgentsResponse = { agents: ['claude', 'opencode'] }
    expect(r.agents).toContain('claude')
  })
})
```

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @trux/protocol test && pnpm --filter @trux/protocol typecheck`

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add packages/protocol
git commit -m "feat(protocol): AgentsResponse DTO"
```

---

## Task 2: Backend — adapter map + /agents + relaxed guard

**Files:** Modify `apps/backend/src/manager.ts`, `apps/backend/src/routes.ts`, `apps/backend/src/server.ts`, `apps/backend/src/index.ts`; Tests `apps/backend/test/manager.test.ts`, `apps/backend/test/routes.test.ts`.

- [ ] **Step 1: Update `apps/backend/src/manager.ts`**

Import `AgentName`:

```ts
import type { AgentName, ApprovalDecision, ServerEvent } from '@trux/protocol'
```

Replace the constructor:

```ts
  constructor(
    private readonly registry: SqliteRegistry,
    private readonly adapters: Map<AgentName, AgentAdapter>,
  ) {}
```

Add after `attach`:

```ts
  availableAgents(): AgentName[] {
    return [...this.adapters.keys()]
  }
```

In `handleUserMessage`, handle a missing adapter:

```ts
  async handleUserMessage(convId: string, text: string): Promise<void> {
    const live = this.ensureSession(convId)
    if (!live) {
      this.emit(convId, { type: 'error', message: 'no adapter for this conversation\'s agent', recoverable: false })
      return
    }
    const turnId = `t_${randomUUID().slice(0, 8)}`
    live.currentTurnId = turnId
    this.emit(convId, { type: 'user_text', turn_id: turnId, text })
    this.emit(convId, { type: 'turn_started', turn_id: turnId })
    this.emit(convId, { type: 'status', state: 'thinking' })
    live.session.send(text)
  }
```

Change `ensureSession` to look up the adapter and return null when missing:

```ts
  private ensureSession(convId: string): LiveSession | null {
    const existing = this.live.get(convId)
    if (existing) return existing
    const conv = this.registry.getConversation(convId)
    if (!conv) throw new Error(`unknown conversation ${convId}`)
    const adapter = this.adapters.get(conv.agent)
    if (!adapter) return null
    const session = adapter.start({
      cwd: conv.cwd,
      resume: conv.native_session_id ?? undefined,
    })
    const live: LiveSession = { session, currentTurnId: null, lastPort: null }
    this.live.set(convId, live)
    void this.pump(convId, live)
    return live
  }
```

- [ ] **Step 2: Update `apps/backend/src/routes.ts`**

Add `AgentName` import:

```ts
import type { AgentName, ConversationDetail, CreateConversationRequest } from '@trux/protocol'
```

Add `agents` param to the signature:

```ts
export function registerRoutes(
  app: FastifyInstance,
  config: Config,
  registry: SqliteRegistry,
  agents: AgentName[],
): void {
```

Add the route (after `/workspaces`):

```ts
  app.get('/agents', async () => ({ agents }))
```

Replace the POST guard + create:

```ts
  app.post('/conversations', async (req, reply) => {
    const body = req.body as CreateConversationRequest
    if (!body || typeof body.cwd !== 'string' || body.cwd.length === 0) {
      return reply.code(400).send({ error: 'cwd is required' })
    }
    if (!agents.includes(body.agent)) {
      return reply.code(400).send({ error: `unknown agent: ${body.agent}` })
    }
    return registry.createConversation({ agent: body.agent, cwd: body.cwd, title: body.title })
  })
```

- [ ] **Step 3: Update `apps/backend/src/server.ts`**

Thread the agent list from the manager into routes. Change the routes
registration:

```ts
  await app.register(async (scope) => {
    registerRoutes(scope, config, registry, manager.availableAgents())
  })
```

- [ ] **Step 4: Update `apps/backend/src/index.ts`**

```ts
  const manager = new ConversationManager(registry, new Map([['claude', new ClaudeAdapter()]]))
```

- [ ] **Step 5: Update `apps/backend/test/manager.test.ts`**

The `FakeAdapter` constructions now need a map. Replace each
`new ConversationManager(registry, adapter)` with
`new ConversationManager(registry, new Map([['claude', adapter]]))`. Add one new
test:

```ts
  it('emits an error for a conversation whose agent has no adapter', async () => {
    const conv = registry.createConversation({ agent: 'codex', cwd: '/repo' })
    const adapter = new FakeAdapter([{ type: 'turn_complete', cost: 0 }])
    const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    expect(seen).toEqual([{ type: 'error', message: 'no adapter for this conversation\'s agent', recoverable: false }])
    expect(manager.availableAgents()).toEqual(['claude'])
  })
```

- [ ] **Step 6: Update `apps/backend/test/routes.test.ts`**

In the `start()` helper, wrap the adapter in a map:

```ts
async function start(adapter: AgentAdapter = new FakeAdapter()): Promise<{ port: number; registry: SqliteRegistry }> {
  db = openDb(':memory:')
  const registry = new SqliteRegistry(db)
  const manager = new ConversationManager(registry, new Map([['claude', adapter]]))
  app = await buildServer(baseConfig, db, registry, manager)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return { port: (app.server.address() as AddressInfo).port, registry }
}
```

The existing "rejects a non-claude agent with 400" test still holds (codex isn't
registered). Add an agents-endpoint test in `describe('REST', ...)`:

```ts
  it('lists available agents', async () => {
    const { port } = await start()
    const res = await (await fetch(`http://127.0.0.1:${port}/agents`)).json()
    expect(res).toEqual({ agents: ['claude'] })
  })
```

- [ ] **Step 7: Run backend suite + typecheck + commit**

Run: `pnpm --filter @trux/backend test && pnpm --filter @trux/backend typecheck`

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/manager.ts apps/backend/src/routes.ts apps/backend/src/server.ts \
        apps/backend/src/index.ts apps/backend/test/manager.test.ts apps/backend/test/routes.test.ts
git commit -m "feat(backend): adapter map per agent + GET /agents"
```

---

## Task 3: Frontend — agent picker

**Files:** Modify `apps/frontend/src/api.ts`, `apps/frontend/src/components/NewConversationDialog.tsx`; Test `apps/frontend/test/components.test.tsx`.

- [ ] **Step 1: Add `listAgents` to `apps/frontend/src/api.ts`**

Add `AgentName`/`AgentsResponse` to the import and the method:

```ts
import type {
  AgentName,
  AgentsResponse,
  Conversation,
  ConversationDetail,
  CreateConversationRequest,
  Workspace,
} from '@trux/protocol'
```

```ts
  listAgents: () => fetch('/agents', { headers: authHeaders() }).then(json<AgentsResponse>),
```

(`AgentName` is used in the dialog; keep the import.)

- [ ] **Step 2: Update `apps/frontend/src/components/NewConversationDialog.tsx`**

```tsx
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
      setAgents(r.agents)
      if (r.agents[0]) setAgent(r.agents[0])
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
```

- [ ] **Step 3: Add a dialog test to `apps/frontend/test/components.test.tsx`**

```tsx
import { NewConversationDialog } from '../src/components/NewConversationDialog'
import { api } from '../src/api'

describe('NewConversationDialog', () => {
  it('renders fetched agents and creates with the selected one', async () => {
    vi.spyOn(api, 'listWorkspaces').mockResolvedValue([{ root: '/repo', worktrees: [{ path: '/repo', branch: 'main' }] }])
    vi.spyOn(api, 'listAgents').mockResolvedValue({ agents: ['claude', 'opencode'] })
    const created = vi.spyOn(api, 'createConversation').mockResolvedValue({
      id: 'c1', agent: 'opencode', cwd: '/repo', title: null, status: 'idle',
      native_session_id: null, archived: false, created_at: 1, updated_at: 1,
    })
    const onCreated = vi.fn()
    render(<NewConversationDialog onCreated={onCreated} />)
    const agentSelect = await screen.findByTestId('agent-select')
    expect(agentSelect).toBeInTheDocument()
    fireEvent.change(agentSelect, { target: { value: 'opencode' } })
    fireEvent.click(screen.getByTestId('create'))
    await waitFor(() => expect(created).toHaveBeenCalledWith({ agent: 'opencode', cwd: '/repo' }))
    vi.restoreAllMocks()
  })
})
```

Add `waitFor` to the `@testing-library/react` import if missing.

- [ ] **Step 4: Run frontend suite + typecheck + build + commit**

Run:
```bash
pnpm --filter @trux/frontend test
pnpm --filter @trux/frontend typecheck
pnpm --filter @trux/frontend build
```

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/frontend/src/api.ts apps/frontend/src/components/NewConversationDialog.tsx apps/frontend/test/components.test.tsx
git commit -m "feat(frontend): agent picker on new conversation"
```

---

## Task 4: Verify

- [ ] **Step 1: Whole-workspace typecheck + test**

```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm -r typecheck && pnpm -r test
```
Expected: all green.

- [ ] **Step 2:** No roadmap tick — Phase 4 boxes wait for a working second agent (4b). 4a is the seam.

---

## Self-Review

**Coverage:** spec §2 backend map + /agents + relaxed guard → Task 2; protocol DTO → Task 1; frontend picker → Task 3. **Types:** `Map<AgentName, AgentAdapter>`, `availableAgents()`, `AgentsResponse`, `registerRoutes(..., agents)`, `api.listAgents` consistent across tasks. **No placeholders.** Existing tests migrated to the map constructor.
