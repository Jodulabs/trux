# Command Palette & Workflows — Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-06-21
**Scope:** Phase A (`/` palette + native-command discovery + run) is the shippable first cut. Phase B (trux-owned editable workflows: store + mobile authoring + one-way import) is a separate plan that builds on A.

---

## Governing principle: the same two oracles

This feature extends the model the unified-controls spec established:

1. **Each backend's native terminal** is the oracle for **content** — *which* commands exist and what they do. trux discovers and surfaces them; it does not invent them.
2. **The unified chat UX** is the oracle for **form** — every command, from every backend, is presented through one consistent palette, the same idiom regardless of which agent is underneath.

The insight that makes this feature tractable: **a command is just a parameterized prompt that resolves to an ordinary message.** `/review $ARGUMENTS` expands to plain text and rides the same `send()` pipeline any turn uses. That collapses "expose agent commands" into "resolve a template and send a turn" — and *any* backend accepts a turn. So trux can own portable workflows with no backend coupling, and surface native ones through the exact same send path.

That yields **two artifacts, distinguished by ownership:**

| | **Native commands** | **trux workflows** |
|---|---|---|
| Owner | the backend (its `.claude/commands/`, its built-ins) | trux (its own store) |
| Content oracle | the agent | trux (it's a trux artifact) |
| Editable in trux? | **No** — read-only, shown labelled | **Yes** — authored/edited on mobile |
| Portability | agent-specific | runs against any backend (resolves to text) |
| Phase | **A** | **B** |

**The palette is the form oracle made concrete.** One frame across all agents: the top is identical regardless of backend; the native section adapts to whatever agent the conversation uses and is honestly labelled as that agent's. A power user opting into `/` has explicitly asked to peek under the hood — that is the progressive-disclosure trade we accept.

**The blade (what trux does *not* do).** trux renders and *resolves* commands; it does not normalize or reimplement an agent's command **execution semantics**. The portable subset is prompt templating + argument substitution (and, if confirmed at plan time, `@file` references). Advanced Claude-Code command directives (`!bash`, `allowed-tools`, per-command model) are **not** ported — commands relying on them stay in the read-only native section and run with the backend's own fidelity, or are marked unsupported. The same blade that keeps trux from being a model-manager keeps it from being a command-runtime.

---

## Architecture overview

```
                       ┌──────────────── Phase A ────────────────┐
backend adapter ──discovers──▶ native commands ──GET /agents──▶ frontend
 (reads .claude/commands,                                          │
  built-ins it can invoke)                                         ▼
                                                            ┌─────────────┐
trux workflow store ──REST──────────────────────────────▶  │ / palette   │
 (DB; user/project scoped)   └────── Phase B ──────┘        │  (sections) │
                                                            └─────┬───────┘
                                                       select + capture args
                                                                  ▼
                                            resolve template ──▶ send() turn
                                              (shared engine)      (existing pipeline,
                                                                   any backend)
```

Moving parts:
1. **Native discovery** (A) — each adapter declares the commands it can actually surface.
2. **Resolution engine** (A) — template + args → prompt text → ordinary turn. Shared by native and workflows.
3. **Palette UI** (A) — `/` opens a sectioned, mobile-first command picker.
4. **Workflow store + authoring** (B) — trux-owned portable templates, edited on the phone.

---

# Phase A — Palette + native discovery + run

## A1. Native command discovery (protocol + adapter)

Extend the manifest in `packages/protocol/src/rest.ts` (alongside `models`/`controls` at `rest.ts:23`):

```ts
// A command the backend exposes that trux can surface and run. Read-only:
// trux discovers it, it does not author or edit it.
export interface AgentCommand {
  name: string                 // invocation token without the slash (e.g. "review")
  description: string          // shown in the palette
  args?: AgentCommandArg[]     // declared params, for the guided arg form (may be [])
  source: 'builtin' | 'file'   // provenance, for honest labelling
}

export interface AgentCommandArg {
  name: string                 // placeholder name (e.g. "ARGUMENTS", "1")
  label: string
  required: boolean
}

export interface AgentCapabilities {
  agent: AgentName
  models: ControlOption[]
  defaultModel: string | null
  controls: AgentControl[]
  commands: AgentCommand[]     // NEW — [] when none discoverable
}
```

`adapter.capabilities()` (already on the seam from the unified-controls work) populates `commands`.

**Claude discovery** (`apps/backend/src/adapter/claude.ts`): read the portable custom commands from the project `.claude/commands/` and user `~/.claude/commands/` (the backend has `cwd` access), parsing each file's name/description (and `$ARGUMENTS`/`$1..$n` placeholders into `args`). `source: 'file'`.

**Exclusions (no duplication with existing UI).** Do *not* surface commands trux already owns through dedicated UI: model selection (it's the `ControlPicker`), and session lifecycle that has its own affordance (new conversation, etc.). A small adapter-level exclusion set keeps the palette from offering a second, conflicting way to do these.

**codex / opencode** ship `commands: []` for now — identical code path, empty section, wired in a follow-up.

> **Plan-time question (not a design unknown):** whether trux drives the backend richly enough to invoke a *named* command verbatim (full backend fidelity) or must resolve the command file itself and send the result (portable subset only). The protocol above supports both; A2 specifies the resolve path, and the verbatim path is a per-adapter optimization decided when the installed SDK's surface is known. Built-in TUI-only slash commands (`/skills`, `/compact`) are surfaced **only if** reachable through trux's interface — if the SDK can't invoke them, they are honestly absent, not faked.

## A2. Resolution engine (backend, shared with Phase B)

One function turns a command/workflow + captured args into the text of a normal turn:

- **Portable substitution:** literal body text, `$ARGUMENTS` (all args joined), and positional `$1..$n`. (`@file` references resolved to file contents are an optional extension, confirmed at plan time.)
- The resolved string is sent through the **existing** `AgentSession.send()` — no new turn pipeline, no new event types. The transcript shows the resolved turn (optionally annotated "via /review") so the conversation stays readable.
- Where an adapter can invoke a command verbatim with full fidelity (per the A1 plan-time branch), it does so instead of resolving; the engine is the fallback that guarantees *something* runs on every backend.

## A3. Palette UI (frontend)

Triggered from the composer (`apps/frontend/src/components/Composer.tsx:178`): when the input is empty (or only `/`), a leading `/` opens the palette instead of inserting a character. Otherwise `/` types normally (escape hatch — see Mobile UX).

Sections, top-down (top is identical across agents; only the agent section varies):

1. **trux** — a minimal built-in set of trux verbs that are genuinely command-shaped and not already a one-tap control. Kept small in Phase A; this section is where Phase B's workflows also land.
2. **`<Agent>` (this conversation)** — the discovered `commands` for the conversation's backend, labelled with the agent name so it's clear these are agent-native and may differ elsewhere.

Behaviour:
- **Fuzzy filter** as the user types after `/`.
- **Recents/frequents first** within sections (mobile users want their 3 commands, not an alphabetical dump) — last-used tracked in `localStorage`, consistent with the existing draft/snippet pattern.
- **Argument capture:** selecting a command with `args` opens a guided form / chips, never raw flag typing.
- On confirm → A2 resolution → `send()`.

One small renderer consumes `AgentCommand` (and, in B, workflows) so adding a backend or a command is data, not new UI — same philosophy as the generic controls renderer.

## A4. Phase A testing (TDD, repo vitest)

- **protocol:** `AgentCommand`/`AgentCommandArg` types; manifest round-trip.
- **backend:** `ClaudeAdapter.capabilities().commands` reflects files in a fixture `.claude/commands/`; excluded commands are absent; the resolution engine substitutes `$ARGUMENTS`/`$1..$n` correctly and routes through a faked `send()`.
- **frontend:** `/` on empty input opens the palette and on non-empty input types a slash; fuzzy filter narrows; the agent section is labelled and empty for an empty manifest; selecting a command with args shows the form and the resolved turn flows into `send()`.
- **regression:** existing suite stays green; typecheck clean.

---

# Phase B — trux workflows (authoring + edit + import)

The editable, portable half. **This is the high-value power-user feature: your custom workflows, authored and run from your phone, against any backend.**

## B1. Workflow store (DB)

A new `workflows` table (forward-only SQLite migration, consistent with the conversations migration):

```
id, scope ('user' | 'project'), project_root (nullable; set when scope='project'),
label, description, body (template text), args (JSON array of {name,label,required}),
created_at, updated_at
```

Workflows are **the user's**, orthogonal to any agent, so they live here — **not** in `AgentCapabilities` (which describes the *agent*). `user` scope is global; `project` scope is keyed to a repo root and only appears for conversations in that project.

## B2. Workflow CRUD (protocol + routes)

REST endpoints (mirroring the existing route style in `apps/backend/src/routes.ts`): list / create / update / delete workflows, filtered by scope + current project. Protocol gains a `Workflow` type and request/response shapes.

## B3. One-way import from native

A discovered native command (A1) can be **imported** into a trux workflow: parse its portable subset (body + placeholders → `args`) into a new editable workflow. **One-way only** — no write-back to `.claude/commands/`, no two-way sync. After import the workflow is trux's and portable; the original native command remains in its read-only section. This is how "discover → edit" is honoured without coupling trux's editable format to one agent.

## B4. Authoring UI (mobile-first form)

A **structured form**, not a markdown/frontmatter editor: `label` → `description` → `body` (textarea with an *insert-argument* helper that injects `$ARGUMENTS`/`$1`) → scope picker (user vs this project). The palette gains a **"＋ New workflow"** entry and an **edit** affordance on each trux workflow. Editing frontmatter-laden markdown with thumbs is the misery this feature exists to remove.

The **portable-subset boundary is explicit in the UI**: the form only offers what resolves portably. We do not present `!bash`/tool-restriction authoring and then have it silently not run.

## B5. Resolution

Reuses the A2 engine unchanged — a workflow resolves and sends exactly like a native command. The palette's trux section now lists built-in verbs **and** the user's/project's workflows.

## B6. Phase B testing

- **backend:** workflow CRUD round-trips; migration adds the table and leaves existing DBs readable; project-scoped workflows only surface for their root; import parses a fixture native command into a workflow with correct `args`.
- **frontend:** the authoring form creates/edits a workflow and it appears in the palette; the insert-argument helper writes the right placeholder; scope picker filters correctly.

---

## Mobile UX requirements (cross-cutting)

trux is a mobile-first chat app; a `/` dropdown is a desktop pattern, so on a coarse pointer the palette is:

- a **bottom sheet sliding up from the composer**, large tap targets, thumb-reachable — not a tiny anchored menu;
- **filter-as-you-type** with recents first;
- **arguments as a guided form/chips**, never raw flag typing;
- with an **escape hatch**: trigger only on empty/leading `/`; offer "send as text"; backspacing past the `/` closes the sheet and restores plain typing.

Desktop keeps the same component with keyboard nav (arrows + Enter). Verify both with mobile-viewport screenshots.

---

## Relationship to the deleted `snippets.ts`

The removed saved-text-snippets feature (`apps/frontend/src/snippets.ts`, localStorage) reached for the same need — fast reusable input on mobile. A workflow is its better-formed successor (named, parameterized, portable). Phase B should decide whether snippets fold in as a lightweight zero-argument workflow rather than returning as a separate concept; the spec assumes they fold in.

---

## Non-goals

- **No command-execution runtime.** trux resolves the portable subset and sends a turn; it does not reimplement `!bash`, `allowed-tools`, or per-command model semantics. Those stay native/read-only.
- **No two-way sync** with `.claude/commands/`. Import is one-way; trux workflows live in trux's store.
- **No duplication of abstracted controls.** Model/effort stay in the `ControlPicker`; lifecycle stays in its own UI. The palette does not offer a second path to them.
- **No faking.** A command that the backend cannot actually run through trux's interface is not shown.
- **No full Claude-Code command power in the editor** — the authoring form owns the portable subset only, and says so.

---

## Open items resolved at plan time (not design unknowns)

- Whether/how the installed Claude Agent SDK lets trux invoke a *named* command verbatim (full fidelity) vs trux resolving the file itself (portable subset) — decides the A1/A2 branch per adapter.
- Whether built-in TUI slash commands (`/skills`, `/compact`, …) are reachable through trux's interface at all; if not, they are honestly absent from the native section.
- Exact custom-command file locations, naming/namespacing, and frontmatter the installed Claude Code uses (project `.claude/commands/`, user `~/.claude/commands/`).
- The precise portable substitution syntax to support (`$ARGUMENTS`, `$1..$n`, and whether `@file` is in scope for v1).
