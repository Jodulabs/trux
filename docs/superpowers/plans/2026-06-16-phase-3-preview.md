# Phase 3 — Preview + Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Render agent screenshots inline (Mode B) and surface an "Open preview" link to the conversation's dev server (Mode A), closing the local dev loop.

**Architecture:** The adapter splits a tool_result's content into a text `output` plus base64 `images[]`. The manager scans tool output/text for a `localhost:<port>` URL and emits a persisted `port_detected` event. The frontend renders images inline and shows an Open-preview button.

**Tech Stack:** unchanged. Image block shape: `{ type:'image', source:{ type:'base64', media_type, data } }` (`@anthropic-ai/sdk@0.104.1`).

**Spec:** `docs/superpowers/specs/2026-06-16-phase-3-preview-design.md`.

---

## File Structure

```
packages/protocol/src/events.ts   # MODIFY: ToolResultEvent.images?; PortDetectedEvent + union
apps/backend/src/
  adapter/types.ts   # MODIFY: AdapterEvent tool_result += images?
  adapter/claude.ts  # MODIFY: split tool_result content into output + images
  ports.ts           # NEW: detectPort(text)
  manager.ts         # MODIFY: stampTurn images passthrough; port detection in pump
apps/frontend/src/
  store.ts           # MODIFY: previewPort state, port_detected handling, replay derive
  components/Transcript.tsx        # MODIFY: render tool_result images
  components/ConversationView.tsx  # MODIFY: Open-preview button
```

---

## Task 1: Protocol — images + port_detected

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Test: `packages/protocol/test/rest.test.ts` (append)

- [ ] **Step 1: Edit `packages/protocol/src/events.ts`**

Add `images` to `ToolResultEvent`:

```ts
export interface ToolResultEvent {
  type: 'tool_result'
  turn_id: string
  tool_id: string
  status: ToolResultStatus
  output: string
  images?: ImageAttachment[]
}
```

Add the event interface after `UserTextEvent`:

```ts
// The detected dev-server port for a conversation (Mode A "Open preview").
export interface PortDetectedEvent {
  type: 'port_detected'
  port: number
}
```

Add `PortDetectedEvent` to the `ServerEvent` union (after `UserTextEvent`):

```ts
export type ServerEvent =
  | HelloEvent
  | UserTextEvent
  | PortDetectedEvent
  | TurnStartedEvent
  | TextDeltaEvent
  | TextEvent
  | ToolCallEvent
  | ToolResultEvent
  | ApprovalRequestEvent
  | StatusEvent
  | TurnCompleteEvent
  | ErrorEvent
```

- [ ] **Step 2: Append tests to `packages/protocol/test/rest.test.ts`**

```ts
import type { PortDetectedEvent, ToolResultEvent } from '../src/index'

describe('phase 3 events', () => {
  it('allows images on a tool_result', () => {
    const ev: ToolResultEvent = {
      type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'shot',
      images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
    }
    expect(ev.images?.[0]?.media_type).toBe('image/png')
  })

  it('builds a port_detected event', () => {
    const ev: PortDetectedEvent = { type: 'port_detected', port: 5173 }
    expect(ev.port).toBe(5173)
  })
})
```

(Add `describe` to the existing vitest import if not already present — it is.)

- [ ] **Step 3: Run + commit**

Run: `pnpm --filter @trux/protocol test && pnpm --filter @trux/protocol typecheck`
Expected: PASS; clean.

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add packages/protocol
git commit -m "feat(protocol): tool_result images + port_detected event"
```

---

## Task 2: detectPort util

**Files:**
- Create: `apps/backend/src/ports.ts`
- Test: `apps/backend/test/ports.test.ts`

- [ ] **Step 1: Write `apps/backend/test/ports.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { detectPort } from '../src/ports'

describe('detectPort', () => {
  it('finds a localhost port from a vite-style line', () => {
    expect(detectPort('  ➜  Local:   http://localhost:5173/')).toBe(5173)
  })
  it('finds a 127.0.0.1 port', () => {
    expect(detectPort('listening on http://127.0.0.1:4317')).toBe(4317)
  })
  it('finds a bare localhost:port', () => {
    expect(detectPort('server up at localhost:3000 now')).toBe(3000)
  })
  it('returns null when no port is present', () => {
    expect(detectPort('nothing here')).toBeNull()
  })
  it('returns the first match', () => {
    expect(detectPort('a localhost:3000 b localhost:4000')).toBe(3000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trux/backend test ports`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `apps/backend/src/ports.ts`**

```ts
// Detect a local dev-server port from agent output (the design's "trux detects"
// path). Matches http://localhost:PORT, http://127.0.0.1:PORT, or bare host:PORT.
const PORT_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{2,5})/

export function detectPort(text: string): number | null {
  const m = PORT_RE.exec(text)
  if (!m) return null
  const port = Number(m[1])
  return port >= 1 && port <= 65535 ? port : null
}
```

- [ ] **Step 4: Run + commit**

Run: `pnpm --filter @trux/backend test ports`
Expected: PASS (5 tests).

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/ports.ts apps/backend/test/ports.test.ts
git commit -m "feat(backend): detectPort util for dev-server preview"
```

---

## Task 3: Adapter — split images from tool_result

**Files:**
- Modify: `apps/backend/src/adapter/types.ts`
- Modify: `apps/backend/src/adapter/claude.ts`
- Test: `apps/backend/test/adapter/claude.test.ts`

- [ ] **Step 1: Edit `apps/backend/src/adapter/types.ts`**

Add `images` to the `tool_result` variant and import `ImageAttachment`:

```ts
import type { AgentName, ApprovalDecision, ImageAttachment, ToolResultStatus } from '@trux/protocol'
```

```ts
  | { type: 'tool_result'; tool_id: string; status: ToolResultStatus; output: string; images?: ImageAttachment[] }
```

- [ ] **Step 2: Add the failing adapter test to `apps/backend/test/adapter/claude.test.ts`**

Add inside `describe('ClaudeAdapter mapping', ...)`:

```ts
  it('splits an image content block out of a tool_result into images[]', async () => {
    const messages = [
      { type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'tu_5', is_error: false, content: [
          { type: 'text', text: 'screenshot saved' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64DATA' } },
        ] },
      ] } },
    ]
    const { fn } = fakeQuery(messages)
    const session = new ClaudeAdapter(fn).start({ cwd: '/repo' })
    const events = await collect(session.events())
    expect(events).toEqual([
      {
        type: 'tool_result', tool_id: 'tu_5', status: 'ok', output: 'screenshot saved',
        images: [{ kind: 'image', media_type: 'image/png', data: 'BASE64DATA' }],
      },
    ])
  })
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @trux/backend test claude`
Expected: FAIL — images not extracted (output contains the JSON-stringified image; no `images`).

- [ ] **Step 4: Update `apps/backend/src/adapter/claude.ts`**

Add the import:

```ts
import type { ApprovalDecision, ImageAttachment } from '@trux/protocol'
```

Replace `stringifyToolOutput` with a splitter that returns text + images:

```ts
// Split a tool_result `content` into a text output plus any base64 images.
function splitToolContent(content: unknown): { output: string; images: ImageAttachment[] } {
  if (typeof content === 'string') return { output: content, images: [] }
  if (!Array.isArray(content)) {
    return { output: content == null ? '' : JSON.stringify(content), images: [] }
  }
  const texts: string[] = []
  const images: ImageAttachment[] = []
  for (const c of content) {
    const block = c as Record<string, unknown>
    if (block.type === 'image') {
      const source = block.source as { type?: string; media_type?: string; data?: string } | undefined
      if (source?.type === 'base64' && typeof source.data === 'string') {
        images.push({ kind: 'image', media_type: source.media_type ?? 'image/png', data: source.data })
      }
    } else if (block && typeof block === 'object' && 'text' in block) {
      texts.push(String((block as { text: unknown }).text))
    } else {
      texts.push(JSON.stringify(block))
    }
  }
  return { output: texts.join(''), images }
}
```

In the `user` case of `consume()`, replace the tool_result push:

```ts
                if (block.type === 'tool_result') {
                  const { output, images } = splitToolContent(block.content)
                  this.outbox.push({
                    type: 'tool_result',
                    tool_id: String(block.tool_use_id ?? ''),
                    status: block.is_error ? 'error' : 'ok',
                    output,
                    ...(images.length > 0 ? { images } : {}),
                  })
                }
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @trux/backend test claude && pnpm --filter @trux/backend typecheck`
Expected: PASS (existing + new image test); clean. (The Phase-1 string-output and error tests still pass — `splitToolContent` returns the same `output` for string/text content.)

- [ ] **Step 6: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/adapter/types.ts apps/backend/src/adapter/claude.ts apps/backend/test/adapter/claude.test.ts
git commit -m "feat(backend): extract inline images from tool_result content"
```

---

## Task 4: Manager — images passthrough + port detection

**Files:**
- Modify: `apps/backend/src/manager.ts`
- Test: `apps/backend/test/manager.test.ts`

- [ ] **Step 1: Add the failing test to `apps/backend/test/manager.test.ts`**

```ts
  it('passes tool_result images through and emits port_detected from output', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      {
        type: 'tool_result', tool_id: 'tu_1', status: 'ok',
        output: 'Local: http://localhost:5173/',
        images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
      },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, adapter)
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()

    const toolResult = seen.find((e) => e.type === 'tool_result') as Extract<ServerEvent, { type: 'tool_result' }>
    expect(toolResult.images?.[0]?.data).toBe('AAAA')
    const port = seen.find((e) => e.type === 'port_detected') as Extract<ServerEvent, { type: 'port_detected' }>
    expect(port.port).toBe(5173)
    // Persisted for reload.
    expect(registry.loadTranscript(conv.id).some((s) => s.event.type === 'port_detected')).toBe(true)
  })

  it('emits port_detected only once for a repeated port', async () => {
    const conv = registry.createConversation({ agent: 'claude', cwd: '/repo' })
    const adapter = new FakeAdapter([
      { type: 'tool_result', tool_id: 'a', status: 'ok', output: 'localhost:5173' },
      { type: 'tool_result', tool_id: 'b', status: 'ok', output: 'still localhost:5173' },
      { type: 'turn_complete', cost: 0 },
    ])
    const manager = new ConversationManager(registry, adapter)
    const seen: ServerEvent[] = []
    manager.attach(conv.id, (e) => seen.push(e))
    await manager.handleUserMessage(conv.id, 'go')
    await settle()
    expect(seen.filter((e) => e.type === 'port_detected')).toHaveLength(1)
  })
```

The `AdapterEvent` for tool_result now allows `images`; update the `FakeSession`/`FakeAdapter` script type if needed (it already takes `AdapterEvent[]`, so the image field is accepted).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @trux/backend test manager`
Expected: FAIL — no `port_detected`, `images` not on wire event.

- [ ] **Step 3: Update `apps/backend/src/manager.ts`**

Add the import:

```ts
import { detectPort } from './ports'
```

Pass `images` through in `stampTurn`'s tool_result case:

```ts
    case 'tool_result':
      return {
        type: 'tool_result',
        turn_id: turnId,
        tool_id: e.tool_id,
        status: e.status,
        output: e.output,
        ...(e.images ? { images: e.images } : {}),
      }
```

Add `lastPort` to `LiveSession`:

```ts
interface LiveSession {
  session: AgentSession
  currentTurnId: string | null
  lastPort: number | null
}
```

Set it when creating the session in `ensureSession`:

```ts
    const live: LiveSession = { session, currentTurnId: null, lastPort: null }
```

In `pump`, after `this.emit(convId, wire)` and the approval_request check, add port detection:

```ts
        if (wire.type === 'tool_result' || wire.type === 'text') {
          const port = detectPort(wire.type === 'tool_result' ? wire.output : wire.text)
          if (port !== null && port !== live.lastPort) {
            live.lastPort = port
            this.emit(convId, { type: 'port_detected', port })
          }
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @trux/backend test manager && pnpm --filter @trux/backend typecheck`
Expected: PASS; clean.

- [ ] **Step 5: Run the whole backend suite + commit**

Run: `pnpm --filter @trux/backend test`
Expected: all green.

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/backend/src/manager.ts apps/backend/test/manager.test.ts
git commit -m "feat(backend): port detection + image passthrough in manager"
```

---

## Task 5: Frontend — images + preview button

**Files:**
- Modify: `apps/frontend/src/store.ts`
- Modify: `apps/frontend/src/components/Transcript.tsx`
- Modify: `apps/frontend/src/components/ConversationView.tsx`
- Test: `apps/frontend/test/store.test.ts`, `apps/frontend/test/components.test.tsx`

- [ ] **Step 1: Add failing store tests to `apps/frontend/test/store.test.ts`**

```ts
describe('previewPort', () => {
  it('sets previewPort from a port_detected event', () => {
    useStore.getState().applyEvent({ type: 'port_detected', port: 5173 })
    expect(useStore.getState().previewPort).toBe(5173)
  })
})
```

- [ ] **Step 2: Update `apps/frontend/src/store.ts`**

`port_detected` is not a transcript item, so `foldEvent` ignores it (its
`default` branch already returns items unchanged — fine). Handle it in
`applyEvent` and derive on replay.

Add to `TruxState`:

```ts
  previewPort: number | null
```

Initial state: `previewPort: null,`.

In `selectConversation`, derive from the transcript replay (last wins) and reset:

```ts
  async selectConversation(id) {
    const detail = await api.getConversation(id)
    const events = detail.transcript.map((s) => s.event)
    const lastPort = events.reduce<number | null>(
      (p, e) => (e.type === 'port_detected' ? e.port : p),
      null,
    )
    set({
      currentId: id,
      status: detail.conversation.status,
      approvalDecisions: {},
      previewPort: lastPort,
      transcript: events.reduce(foldEvent, [] as TranscriptItem[]),
    })
  },
```

In `applyEvent`, handle the port before the transcript fold:

```ts
  applyEvent(event) {
    if (event.type === 'status') {
      set({ status: event.state })
      return
    }
    if (event.type === 'port_detected') {
      set({ previewPort: event.port })
      return
    }
    set({ transcript: foldEvent(get().transcript, event) })
  },
```

- [ ] **Step 3: Add the failing Transcript image test to `apps/frontend/test/components.test.tsx`**

```ts
  it('renders an inline image for a tool_result with images', () => {
    const items: TranscriptItem[] = [
      {
        type: 'tool_result', turn_id: 't1', tool_id: 'x', status: 'ok', output: 'shot',
        images: [{ kind: 'image', media_type: 'image/png', data: 'AAAA' }],
      },
    ]
    render(<Transcript items={items} approvalDecisions={{}} onRespond={() => {}} />)
    const img = screen.getByTestId('tool-image') as HTMLImageElement
    expect(img.src).toContain('data:image/png;base64,AAAA')
  })
```

- [ ] **Step 4: Update `apps/frontend/src/components/Transcript.tsx`**

Replace the tool_result branch (the final `return`) to render images:

```tsx
        return (
          <details key={i} className={`tool ${item.status}`}>
            <summary>← {item.status}</summary>
            {item.output ? <pre>{item.output}</pre> : null}
            {item.images?.map((img, j) => (
              <img
                key={j}
                data-testid="tool-image"
                className="tool-image"
                src={`data:${img.media_type};base64,${img.data}`}
                alt="tool output"
              />
            ))}
          </details>
        )
```

- [ ] **Step 5: Update `apps/frontend/src/components/ConversationView.tsx`**

Add `previewPort` from the store and an Open-preview button. After the
`approvalDecisions`/`recordApproval` selectors add:

```tsx
  const previewPort = useStore((s) => s.previewPort)
```

In the returned JSX, add the button next to the status line:

```tsx
      <div className="conversation-bar">
        <div data-testid="status-line" className={`status ${status}`}>{STATUS_LABEL[status] ?? status}</div>
        {previewPort !== null ? (
          <button
            data-testid="open-preview"
            onClick={() => window.open(`http://localhost:${previewPort}`, '_blank')}
          >
            Open preview :{previewPort}
          </button>
        ) : null}
      </div>
```

(Remove the standalone `status-line` div that was there before — it now lives in
`conversation-bar`.)

- [ ] **Step 6: Add the ConversationView preview test to `apps/frontend/test/components.test.tsx`**

ConversationView opens a real WS via `connectTrux`; to test the button in
isolation without a socket, stub `WebSocket` and seed the store. Add:

```tsx
import { ConversationView } from '../src/components/ConversationView'
import { useStore } from '../src/store'

class NoopWS {
  constructor(public url: string) {}
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}

describe('ConversationView preview', () => {
  it('shows Open preview when a port is known and opens it', () => {
    vi.stubGlobal('WebSocket', NoopWS)
    const open = vi.fn()
    vi.stubGlobal('open', open)
    useStore.setState({ previewPort: 5173, transcript: [], status: 'idle', approvalDecisions: {} })
    render(<ConversationView id="c1" />)
    fireEvent.click(screen.getByTestId('open-preview'))
    expect(open).toHaveBeenCalledWith('http://localhost:5173', '_blank')
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 7: Run the frontend suite + typecheck + build**

Run:
```bash
pnpm --filter @trux/frontend test
pnpm --filter @trux/frontend typecheck
pnpm --filter @trux/frontend build
```
Expected: all pass; clean build.

- [ ] **Step 8: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add apps/frontend/src/store.ts apps/frontend/src/components/Transcript.tsx \
        apps/frontend/src/components/ConversationView.tsx \
        apps/frontend/test/store.test.ts apps/frontend/test/components.test.tsx
git commit -m "feat(frontend): inline tool images + Open preview button"
```

---

## Task 6: End-to-end verification + roadmap

- [ ] **Step 1: Whole-workspace typecheck + test**

Run:
```bash
cd /home/gp/dreamLand/jodulabs/trux
pnpm -r typecheck
pnpm -r test
```
Expected: all three packages typecheck; every suite passes.

- [ ] **Step 2: Manual live run**

```bash
TRUX_WORKSPACES="$HOME/dreamLand/jodulabs/trux" pnpm dev
```
1. Create a claude conversation on the trux repo.
2. Ask: `start the frontend dev server in the background and tell me the URL` →
   approve the Bash → the **Open preview :PORT** button appears; click it → the
   app opens in a new tab.
3. Ask: `take a screenshot of localhost:<port> with Playwright and show me` (or
   `read <some>.png and show it`) → the image renders **inline** in the transcript.

- [ ] **Step 3: Tick roadmap Phase 3**

In `docs/2026-06-16-trux-roadmap.md`, change the three Phase 3 `- [ ]` items to
`- [x]` and append ` ✓ 2026-06-16` to the "Done when" line and the ⭐ milestone.

- [ ] **Step 4: Commit**

```bash
cd /home/gp/dreamLand/jodulabs/trux
git add docs/2026-06-16-trux-roadmap.md
git commit -m "docs(roadmap): mark Phase 3 complete"
```

---

## Self-Review

**Spec coverage:**
- §3 protocol (images + port_detected) → Task 1. ✅
- §4 Mode B adapter image split → Task 3 (+ types in Task 3). ✅
- §5 Mode A detection util + manager emit → Tasks 2, 4. ✅
- §5 frontend previewPort + Open preview + image render → Task 5. ✅
- §7 testing (protocol, detectPort, adapter, manager, store, Transcript, ConversationView) → Tasks 1–5; manual → Task 6. ✅

**Placeholder scan:** none — all code complete.

**Type consistency:** `ToolResultEvent.images?`, `PortDetectedEvent`, `AdapterEvent` tool_result `images?`, `detectPort(text): number|null`, `LiveSession.lastPort`, store `previewPort`, Transcript image render, ConversationView `open-preview` are defined once and referenced identically. `port_detected` is persisted (durable, not text_delta) so reload replay in `selectConversation` recovers it.

**Backward compat:** `images` optional, `port_detected` additive — Phase 1/2 transcripts still parse. `splitToolContent` returns the same `output` as the old `stringifyToolOutput` for string/text content, so existing tool_result tests hold.
