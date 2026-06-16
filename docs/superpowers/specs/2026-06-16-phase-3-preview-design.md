# Phase 3 — Local dev loop: preview + verification (Design Spec)

*Companion to [the design spec](../../2026-06-16-trux-design.md) §Output
verification / preview, and [roadmap](../../2026-06-16-trux-roadmap.md). Builds on
Phase 2 (approvals + interrupt).*

**Status:** approved design (proceeding to implementation per user instruction).

---

## 1. Goal & "done when"

Close the dev loop at the desk: you ask Claude for a UI change, **see its
screenshot inline** (Mode B), *and* **click through to the live app** (Mode A).

This completes the ⭐ Claude-only v1 milestone (Phases 0–3 useful locally).

Roadmap items:
- Render image `tool_result`s (agent Playwright screenshots show inline — Mode B).
- Per-conversation **port registry** (agent announces / trux detects the dev-server port).
- "Open preview" → `localhost:<port>` in a new tab (Mode A, local).

---

## 2. Verified facts — image content blocks

*(read from installed `@anthropic-ai/sdk@0.104.1` types, 2026-06-16)*

A tool_result whose content includes an image carries an Anthropic
`ImageBlockParam`:

```ts
{ type: 'image', source: { type: 'base64', media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: string } }
```

Claude Code produces these when the agent `Read`s an image file (e.g. a
Playwright screenshot saved to disk) or an MCP screenshot tool returns one. The
existing protocol `ImageAttachment { kind:'image', media_type, data }` maps it
directly. (A `URLImageSource` variant also exists; Phase 3 handles base64 only —
the local screenshot path — and ignores URL sources.)

---

## 3. Protocol changes

Two additive changes to `@trux/protocol`:

```ts
// ToolResultEvent gains optional inline images (base64). Absent for text-only results.
export interface ToolResultEvent {
  type: 'tool_result'
  turn_id: string
  tool_id: string
  status: ToolResultStatus
  output: string
  images?: ImageAttachment[]
}

// The detected dev-server port for a conversation (Mode A "Open preview").
export interface PortDetectedEvent {
  type: 'port_detected'
  port: number
}
```

`PortDetectedEvent` joins the `ServerEvent` union. No client-message changes.
Persisting `port_detected` as a normal transcript event means a browser reload
recovers the port via transcript replay — **no conversations-table migration**.

---

## 4. Mode B — inline images (adapter)

Today `stringifyToolOutput` flattens every content block (including images) into
the `output` string, so image data is lost in JSON noise. Phase 3 splits the
tool_result content:

- **text** blocks (and string content) → `output` (unchanged behavior).
- **image** blocks (`{ type:'image', source:{ type:'base64', media_type, data } }`)
  → an `ImageAttachment` appended to `images[]`.

The adapter's `AdapterEvent` `tool_result` variant gains `images?:
ImageAttachment[]`; the manager's `stampTurn` passes it through onto the wire
`ToolResultEvent`. Defensive: unknown source types are skipped, never thrown.

The frontend `Transcript` renders `tool_result.images` as inline
`<img src="data:${media_type};base64,${data}">` inside the result block.

---

## 5. Mode A — port detection + preview (manager + frontend)

### Detection
A pure util `detectPort(text): number | null` scans for the first
`http://localhost:<port>` or `http://127.0.0.1:<port>` (also bare
`localhost:<port>`), returning the port or null. It is the design's "trux
detects" path — no custom MCP tool needed.

The manager, in its event pump, runs `detectPort` over each emitted
`tool_result` (its `output`) and `text` event. It tracks the last emitted port
per live session; when a newly detected port differs, it emits a
`port_detected` event (persisted + broadcast like any durable event). "Latest
wins" — if the agent restarts the dev server on a new port, the button updates.

This belongs in the **manager** (orchestration), not the Claude adapter, so
future agents (codex/opencode) get preview detection for free.

### Frontend
- `store` tracks `previewPort: number | null`, set on `port_detected` (live) and
  derived during `selectConversation` transcript replay (last `port_detected`
  wins). Reset on conversation switch.
- `ConversationView` renders an **Open preview** button when `previewPort` is
  set → `window.open('http://localhost:' + previewPort, '_blank')` (new tab,
  per design — robust, no embedded iframe in v1).

---

## 6. Data flow

```
agent runs `pnpm dev` (backgrounded) → BashOutput tool_result contains
  "Local: http://localhost:5173/"
manager pump: detectPort(output) → 5173 (new) → emit port_detected{5173}
  → persist + broadcast
frontend store: previewPort = 5173 → "Open preview" button appears
user clicks → opens http://localhost:5173 in a new tab

agent screenshots app → Read screenshot.png → tool_result with image block
  → adapter splits → ToolResultEvent.images=[{kind:image,...}]
frontend Transcript → <img> inline
```

---

## 7. Testing strategy

| Unit | How |
|---|---|
| protocol | `ToolResultEvent.images` + `PortDetectedEvent` constructible / in `ServerEvent`. |
| `detectPort` | localhost/127.0.0.1/bare forms, no-match, first-match. |
| adapter | tool_result with mixed text+image content → `output` text-only + `images[]`; text-only unchanged. |
| manager | emits `port_detected` once per changed port from a tool_result; passes `images` through. |
| frontend store | `port_detected` sets `previewPort`; replay derives it; reset on switch. |
| frontend Transcript | renders an `<img>` for an image tool_result. |
| frontend ConversationView | Open-preview button appears with a port, opens the URL. |

Live verification (manual): ask Claude to start the dev server and screenshot a
page → see the port button + inline screenshot, click through.

---

## 8. Explicitly deferred

- Remote preview (Tailscale serve / proxy) — Phase 5; Phase 3 is local only.
- URL image sources, PDF results — base64 images only.
- Embedded split-view; subdomain-per-conversation proxy — Later.
- Robust port lifecycle (detecting server shutdown) — "latest wins" is enough locally.

---

## 9. Module boundaries

Adapter still owns only native→NCP translation (now incl. image extraction);
manager owns orchestration (now incl. port detection + the `port_detected`
event); store/components own rendering. `detectPort` is a pure, separately tested
util. The protocol stays the single contract; both additions are backward
compatible (optional field + additive event).
