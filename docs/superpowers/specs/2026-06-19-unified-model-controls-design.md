# Unified Model & Controls — Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-06-19
**Scope:** Claude wired for real; codex/opencode declare empty manifests and are wired in a follow-up.

---

## Governing principle: two oracles

trux is **one unified, polished chat UX (Claude.ai / ChatGPT-grade, mobile-first), wired to your real code resources, with any coding backend underneath.** Every design question about this feature is answered by one of two oracles:

1. **Each backend's native terminal** is the oracle for **content** — *which* models and controls exist, their **defaults**, and their **behavior** (including what a mid-conversation change does). Running `claude` in a terminal gives you its model picker, its effort/thinking, its defaults; trux surfaces exactly those. Same for `codex`, `opencode`.

2. **The unified chat UX** (Claude/ChatGPT) is the oracle for **form** — how controls are *presented*: one consistent, polished chat shell, the same idiom regardless of which backend is underneath. A model/effort switcher in trux feels like the model dropdown in a consumer chat app, not three transplanted terminal UIs.

**trux is not a model manager.** It does not normalize controls into a universal axis, choose defaults, or impose behavior (e.g. no mid-conversation-switch policy). It declares what a backend offers, renders it through one generic chat-grade UI, routes the selection to the backend's native interface, and remembers your last pick. The same blade that excludes a git tool (the backend already does git when asked) excludes a model-management policy layer here.

This feature closes the gap that the seam exposes today: `AgentAdapter.start({cwd, resume})` (`apps/backend/src/adapter/types.ts`) has nowhere to carry model or effort, `ClaudeAdapter.start` (`apps/backend/src/adapter/claude.ts`) passes no model, and `AgentsResponse {agents: AgentName[]}` (`packages/protocol/src/rest.ts`) names backends but declares none of their capabilities.

---

## Architecture overview

```
backend adapter ──declares──▶ capability manifest ──GET /agents──▶ frontend
                                                                      │ renders generically
                                                                      ▼
                                                          unified chat controls
                                                          (new-conversation + composer)
                                                                      │ selection {model, options}
                       per-turn, via native interface ◀──send/create─┘
                                  │
                                  ▼
                          backend's native knobs
                       (Claude SDK model+effort; codex flags; …)
```

Four moving parts:
1. **Capability manifest** — each adapter declares its native controls (static).
2. **Selection** — `{model, options}` chosen in the unified UI, carried per turn.
3. **Routing** — adapter applies the selection via the backend's native interface, at that interface's granularity. No policy on top.
4. **Persistence** — the conversation row remembers the last selection (sticky); the frontend pre-fills from it and shows it in the list.

---

## Component 1: Capability manifest (protocol)

A **faithful manifest of each backend's native controls** — not a trux abstraction. `model` is first-class (every backend has one, and it is the thing most worth showing per conversation); everything else is an **opaque, pass-through control** trux renders but never interprets.

In `packages/protocol/src/rest.ts`:

```ts
// One selectable value for a model or a control.
export interface ControlOption {
  value: string   // sent to the backend verbatim (e.g. "claude-opus-4-8", "high")
  label: string   // shown in the UI (e.g. "Opus 4.8", "High")
}

// A generic, opaque-to-trux knob the backend exposes (effort, reasoning, verbosity, …).
export interface AgentControl {
  key: string                 // identifier in the options bag (e.g. "effort")
  label: string               // UI label (e.g. "Effort")
  options: ControlOption[]    // mirrors the backend's native choices
  default: string             // a ControlOption.value; mirrors the backend's native default
}

// A backend's full control surface, mirroring its native terminal.
export interface AgentCapabilities {
  agent: AgentName
  models: ControlOption[]          // [] when the backend declares none yet
  defaultModel: string | null      // a models[].value, or null
  controls: AgentControl[]         // [] when none declared yet
}

// Replaces the old `{ agents: AgentName[] }`.
export interface AgentsResponse {
  agents: AgentCapabilities[]
}
```

**Claude's manifest** mirrors Claude Code's own surface. The exact model list, control set, and **defaults are read from the installed `@anthropic-ai/claude-agent-sdk` / Claude Code at plan time, not chosen here** — trux must not invent them. The model IDs are the bare strings from the Claude API reference (`claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`); the effort control mirrors the SDK's effort levels. Illustrative shape (values confirmed during implementation):

```ts
// ILLUSTRATIVE — final models/levels/defaults come from the SDK, not this doc.
{
  agent: 'claude',
  models: [
    { value: 'claude-opus-4-8',  label: 'Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
    { value: 'claude-haiku-4-5',  label: 'Haiku 4.5' },
  ],
  defaultModel: '<Claude Code default>',
  controls: [
    { key: 'effort', label: 'Effort',
      options: [/* the SDK's effort levels */], default: '<SDK default>' },
  ],
}
```

**codex / opencode** ship `{ agent, models: [], defaultModel: null, controls: [] }` for now. The UI renders nothing extra for them — identical code path, empty manifest. They are wired for real in a follow-up by populating their manifests and mapping in their adapters.

`GET /agents` (`apps/backend/src/routes.ts`, currently `app.get('/agents', () => ({ agents }))`) returns the manifests instead of the name list.

---

## Component 2: The selection

```ts
// packages/protocol — carried on conversation create and on every send.
export interface TurnConfig {
  model: string | null               // a models[].value, or null = backend default
  options: Record<string, string>    // control key → ControlOption.value; opaque to trux
}
```

`model` is first-class and typed; `options` is an opaque map keyed by `AgentControl.key`. trux never inspects `options` contents — it stores them and hands them to the adapter.

---

## Component 3: Adapter seam & routing (no policy)

The seam grows an optional `config`. In `apps/backend/src/adapter/types.ts`:

```ts
export interface AgentAdapter {
  readonly name: AgentName
  start(opts: { cwd: string; resume?: string; config?: TurnConfig }): AgentSession
  capabilities(): AgentCapabilities      // NEW — the adapter's manifest
}

export interface AgentSession {
  send(text: string, attachments?: ImageAttachment[], config?: TurnConfig): void
  // …unchanged: events, interrupt, close, nativeSessionId, respondApproval
}
```

**Routing rule (the heart of the no-policy stance):** the adapter applies `config` via its backend's **native mechanism, at whatever granularity that mechanism supports**. trux adds no switching logic on top.

- **Claude** (`apps/backend/src/adapter/claude.ts`): pass `config.model` into the Agent SDK `query()` options, and map `config.options` (e.g. `effort`) onto the SDK's corresponding option. **The exact SDK option names are verified against the installed `@anthropic-ai/claude-agent-sdk` types during implementation** — this doc does not guess them. Whether a mid-conversation change takes effect immediately, next turn, or only on a new session is **the SDK's behavior, surfaced honestly** — trux does not engineer restart/resume or "fixed once live" semantics.
- **codex** (`apps/backend/src/adapter/codex.ts`, follow-up): codex spawns a fresh `codex exec` per turn, so model/effort apply as native flags per-turn for free — again, because that's what codex does, not because trux made per-turn switching a guarantee.
- **opencode** (follow-up): native provider/model params on its session calls.

`manager.ts` (the only caller of `adapter.start`, at `apps/backend/src/manager.ts:185`) threads the conversation's stored `TurnConfig` into `start`, and the per-turn config into `send`.

---

## Component 4: Persistence (sticky per conversation)

This is **trux's own UI memory** — what the picker pre-fills and the list shows — not a model-behavior opinion, so trux owns it.

- `conversations` table gains two nullable columns: `model TEXT`, `options TEXT` (JSON of the opaque bag).
- A forward-only SQLite migration adds the columns; existing rows read as `null`.
- On conversation create: seed from the chosen `TurnConfig`, or from the manifest's `defaultModel` / control defaults when unspecified.
- On each turn: the selection is written back to the row (last-used wins).
- `Conversation` (`packages/protocol/src/rest.ts`) gains `model: string | null` and `options: Record<string,string>` so the list and composer can read them.

The conversation list can then show the backend + model at a glance (e.g. `claude · opus`), reading the stored `model`.

---

## Component 5: Unified chat UI (form oracle)

One generic, chat-grade renderer draws **every backend's controls identically** — the renderer *is* the unification. No backend-specific widgets, no hardcoded knowledge of "effort" in the frontend.

- **New-conversation** (`apps/frontend/src/components/NewConversationDialog.tsx`): after picking the agent, fetch that agent's `AgentCapabilities` from the (now richer) `/agents` response and render:
  - a **model** dropdown from `models` (hidden when `models` is empty),
  - one dropdown per entry in `controls`, looping generically (label + options),
  - pre-selected to `defaultModel` / each control's `default`.
  The chosen `{model, options}` is sent on `createConversation`.
- **Composer** (in `ConversationView`): the same compact model/control dropdowns live in the composer so the selection can change **per turn**, styled like a consumer-chat model switcher, mobile-first (consistent with the project's existing chat-first UX). The chosen `{model, options}` rides each `send`. The composer pre-fills from the conversation's stored (sticky) selection.

Both surfaces consume the manifest through the same small renderer component, so adding a backend or a control is data, not new UI code.

---

## Testing (TDD, repo vitest)

- **protocol:** `AgentCapabilities` / `TurnConfig` types; parse/serialize round-trip if applicable.
- **backend:**
  - `ClaudeAdapter.capabilities()` returns a manifest with a model list + effort control.
  - `ClaudeAdapter` passes `config.model` and the mapped effort option into a **faked `query()`** (the existing tests already inject a fake `QueryFn`).
  - conversation row persists and reads back `model` + `options`; create seeds from manifest defaults; per-turn write updates last-used.
  - the SQLite migration adds columns and leaves existing rows readable.
- **frontend:**
  - the generic renderer draws an arbitrary manifest (model dropdown + N controls) and omits the model dropdown for an empty manifest.
  - selection flows into `createConversation` and into `send`.
  - the composer pre-fills from the conversation's stored selection.
- **regression:** the existing 201 tests stay green; typecheck clean.

---

## Scope & sequencing

1. Full generic machinery: protocol manifest + selection, seam `config`, `/agents` manifests, persistence + migration, unified renderer.
2. Claude wired for real (manifest mirrors Claude Code; adapter maps model + effort via the SDK).
3. codex/opencode ship empty manifests (no UI controls, unchanged behavior).
4. **Follow-up (separate plan):** populate codex/opencode manifests and map their native flags/params.

---

## Non-goals

- **No model-management policy.** No universal effort axis, no trux-chosen defaults, no mid-conversation-switch semantics. Content/behavior/defaults are the backend's; form is the unified chat UX.
- **No reimplementation of backend capabilities** (git, etc.) — the backend already does those when asked.
- **No dynamic model discovery** — manifests are static per adapter (a new model is a one-line manifest change). Revisit only if a backend makes its model list cheaply queryable and the staleness matters.
- **codex/opencode native mapping** is explicitly deferred to the follow-up plan.

---

## Open items resolved at plan time (not design unknowns)

- Exact Agent SDK option names for `model` and `effort`/thinking — read from the installed `@anthropic-ai/claude-agent-sdk` types.
- Claude Code's actual default model and effort level — read from the SDK/CLI, mirrored into the manifest.
- Whether the Agent SDK accepts model/effort per-`query()` only or per-message — determines where the adapter applies `config`; either way trux just uses the SDK's interface as-is.
