# Phase 7 — Multiplexer (plan)

Spec: `docs/superpowers/specs/2026-06-17-trux-v2-design.md` §7 "Store-level multiplexed connection manager", "Unread + needs-you roster in sidebar", "Bottom-anchored mobile quick-switcher", "Per-conversation drafts".

**Goal:** Run multiple agents in parallel, see at a glance which is blocked on you, switch without losing a draft.

## Architecture

### Per-conversation meta state

Add `convMeta: Record<string, ConvMeta>` to the Zustand store where:
```ts
type ConvMeta = { status: string; unread: number; connState: ConnState; lastSeq: number }
```
Kept in sync by background connections. Drives sidebar dots and unread badges.

### Multiplexed connection manager

`connections` is a module-level `Map<string, TruxClient>` (closure variable, not reactive). A connection is opened once per conversation ID and never torn down on switch.

Each connection's event handler has two lanes:
1. **Always**: update `convMeta[id]` (status, lastSeq, bump unread if id ≠ currentId)
2. **If active** (`id === currentId`): also call `applyEvent` + outbox dequeue + haptics

`ConversationView` no longer creates its own `TruxClient`. Instead it registers active-conversation handlers via module-level callbacks (`setActiveHandlers` / `clearActiveHandlers`), then calls `openConnection(id)`. Sending/responding still goes through `connections.get(id)`.

### Per-conversation drafts

Persisted to `localStorage` keyed `trux-draft-${id}`. Composer reads on id change (via `useEffect`), writes on every keystroke (`onChange`). Cleared on send. Pencil badge (`.draft-badge`) shown on sidebar list item when draft is non-empty.

### Bottom quick-switcher (mobile)

`QuickSwitcher.tsx` — bottom-anchored pill row, visible only on `(pointer: coarse)` and `(max-width: 640px)`. Shows up to 5 most-recently-active conversations with status dot + short title. Tapping switches. Hidden when sidebar is the full-width top panel (mobile already sees the sidebar; only need the switcher when a full conversation view is open).

## Tasks (TDD, per-task commit)

1. **`convMeta` in store** — add state shape + `setConvMeta` / `bumpUnread` / `clearUnread`; test: reducer correctly updates map entries.
2. **Multiplexed connection manager** — `openConnection` in store (module-level connections map + active-handler callbacks); update `ConversationView` to use it; test: two openConnection calls for the same id don't double-connect; background events update convMeta but don't fold into transcript.
3. **Sidebar unread + live dots** — use `convMeta[id].status` + unread badge; `selectConversation` clears unread; test: selecting clears badge.
4. **Per-conversation drafts** — localStorage persistence in Composer; pencil badge in Sidebar; test: draft survives conversation switch.
5. **Bottom quick-switcher** — `QuickSwitcher.tsx` + CSS; test: renders conversation list, tapping calls onSelect.
