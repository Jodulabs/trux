# Phase 4c — Codex adapter design

*Branch: `phase-4c-codex` · Companion: [roadmap](../../../docs/2026-06-16-trux-roadmap.md)*

---

## Goal

Wire `codex exec --json` into the trux `AgentAdapter` seam so conversations can be driven by Codex through the same UI as Claude and opencode.

---

## Codex exec JSONL event schema

`codex exec --json -C <cwd> [-s <sandbox>] <prompt>` emits one JSON object per line:

| Event type | Key fields | Maps to |
|---|---|---|
| `thread.started` | `thread_id` | (captured; used for resume) |
| `item.started` | `item.id`, `item.type=command_execution`, `item.command` | `tool_call` |
| `item.completed` | `item.id`, `item.type`, payload fields | `text` / `tool_result` / `error` |
| `turn.completed` | `usage.input_tokens`, `usage.output_tokens` | `turn_complete` |

`item.completed` variants:
- `type=agent_message` → `text` (field: `item.text`)
- `type=command_execution` → `tool_result` (fields: `item.aggregated_output`, `item.exit_code`, `item.status`)
- `type=error` → `error` (field: `item.message`)

Multi-turn: first turn → `codex exec --json -C <cwd> -s <sandbox> <prompt>`; subsequent turns → `codex exec resume --json <thread_id> <prompt>`.

---

## Sandbox policy

Default: `workspace-write` — allows file reads and writes within the workspace, which is the common case for a coding agent. Codex does not emit per-tool approval requests; sandbox is set at process spawn time. The adapter skips `approval_request` events entirely.

---

## Component design

### `CodexMapper` (pure, stateless)

`apps/backend/src/adapter/codex-map.ts`

```ts
export interface CodexEvent { type: string; [k: string]: unknown }
export function mapCodexLine(e: CodexEvent, state: CodexMapState): AdapterEvent[]
export interface CodexMapState { threadId: string | null }
```

- `thread.started` → set `state.threadId`, return `[]`
- `item.started` + `type=command_execution` → `tool_call { tool_id: item.id, name: 'bash', input: { command } }`
- `item.completed` + `type=agent_message` → `text { text: item.text }`
- `item.completed` + `type=command_execution` → `tool_result { tool_id: item.id, status: exit_code===0?'ok':'error', output: aggregated_output }`
- `item.completed` + `type=error` → `error { message, recoverable: true }`
- `turn.completed` → `turn_complete { usage: { input: input_tokens, output: output_tokens }, cost: null }`
- everything else → `[]`

### `CodexSession` / `CodexAdapter`

`apps/backend/src/adapter/codex.ts`

```ts
type SpawnFn = (args: string[], opts: { cwd: string }) => ChildProcessLike
export class CodexAdapter implements AgentAdapter { ... }
class CodexSession implements AgentSession { ... }
```

`CodexSession`:
- `outbox: PushQueue<AdapterEvent>`
- `mapState: CodexMapState` — persists `threadId` across turns
- `activeProc: ChildProcessLike | null` — for interrupt
- `send(text)`:
  1. Build args: first turn → `['exec','--json','-C',cwd,'-s','workspace-write',text]`; resume → `['exec','resume','--json',state.threadId,text]`
  2. Spawn process, pipe stdout line-by-line through `mapCodexLine`
  3. Push each `AdapterEvent` to outbox; on close if no `turn_complete` was emitted push one
- `interrupt()` → `activeProc?.kill('SIGTERM')`
- `nativeSessionId()` → `mapState.threadId`
- `respondApproval()` → no-op (codex has no per-tool approvals)
- `close()` → kill proc, end outbox

`CodexAdapter.start()` → `new CodexSession(spawnFn, cwd, resume)`

Default `spawnFn` wraps `child_process.spawn('codex', args, { cwd })`.

---

## Injection seam for tests

Tests inject a fake `spawnFn` returning a controllable `EventEmitter`-based mock that emits stdout lines and an exit event — no real codex binary needed.

---

## Files

| File | Action |
|---|---|
| `apps/backend/src/adapter/codex-map.ts` | NEW |
| `apps/backend/src/adapter/codex.ts` | NEW |
| `apps/backend/test/adapter/codex-map.test.ts` | NEW |
| `apps/backend/test/adapter/codex.test.ts` | NEW |
| `apps/backend/src/index.ts` | add `codex` adapter |
| `docs/2026-06-16-trux-roadmap.md` | check off codex |
