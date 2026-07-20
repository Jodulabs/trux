# Pi Harness, Agent Catalog, and Mobile Controls — Implementation Plan

**Status:** revised plan, awaiting approval  
**Date:** 2026-07-20  
**Product direction:** Trux is a mobile-first supervision surface for coding agents running on the user's machines. It must not privilege one coding agent, model vendor, credential type, or subscription. Users may have several agent subscriptions and accounts at the same time.

---

## Decision

Do not ship the previous combined Pi + API-key provider picker + static model catalog plan.

The previous plan mixed three independently useful concerns:

1. running a Pi conversation,
2. connecting credentials and subscriptions,
3. selecting models and native controls.

That made a small harness addition depend on a Pi-shaped authentication and controls design. It also made API keys the primary Pi path, conflicting with the existing subscription-first product decision.

This plan instead delivers three independent tracks:

1. **Pi harness:** add Pi through the existing `AgentAdapter` seam, using credentials already owned by Pi.
2. **Agent catalog and accounts:** consolidate agent, authentication, and capability identity into one mobile-facing catalog; support multiple connected accounts.
3. **Native controls:** discover choices from the installed agent/account when practical and render them generically on mobile.

Each track can ship without waiting for the next.

---

## Product principles

### 1. Develop from mobile

The primary workflow is:

1. Open Trux on the phone.
2. Choose a machine/project.
3. Choose an installed agent and, when necessary, a connected account.
4. Start or resume work.
5. Intervene only for prompts, approvals, controls, or review.

Backend interfaces should serve this flow. Terminal parity is useful only where it improves mobile supervision.

### 2. Agent-neutral by default

Claude, Codex, opencode, Pi, and future agents are peer harnesses. A new agent should require an execution adapter and event translation, not changes throughout routes, persistence, authentication, and mobile screens.

Capabilities are progressive enhancement. An agent with no discoverable model list must still work using its native default.

### 3. Subscription-first, API keys second

Trux should orchestrate each agent CLI's native authentication instead of reimplementing vendor OAuth. Existing CLI login state is immediately usable. From mobile, Trux may relay device URLs/codes or a terminal login session when the CLI supports it.

API keys remain a fallback for agents/providers that require them. They are not the organizing concept for the product.

### 4. Multiple accounts are normal

A user may have several subscriptions or credentials across agents, and potentially more than one account for the same agent. Do not encode authentication as one status bit per agent.

The product concepts are distinct:

- **Agent:** executable harness such as `claude`, `codex`, `opencode`, or `pi`.
- **Account:** a connected subscription or credential usable by an agent.
- **Model and native controls:** choices exposed for the selected agent/account.
- **Trust:** Trux permission behavior such as ask-per-tool or allow-all.

“Provider” is not a top-level Trux concept. It may remain an opaque native control when an agent such as Pi exposes it.

### 5. Native facts stay native

The installed CLI and connected account are the source of truth for available models, controls, defaults, authentication state, and resume behavior. Trux may cache discovered information, but should avoid maintaining model catalogs.

When discovery is unavailable, Trux exposes “native default” rather than guessing.

---

## Current baseline

Unified controls are no longer wholly deferred. The current tree already contains:

- `AgentCapabilities`, `TurnConfig`, and conversation `model` / `options` in the protocol;
- `config` on the `AgentAdapter` / `AgentSession` seam;
- SQLite persistence of the last model/options selection;
- a generic mobile `ControlPicker` used by new-conversation and composer flows;
- a populated Claude manifest and adapter routing;
- empty Codex and opencode manifests.

This plan extends and corrects that baseline. It does not rebuild it.

One existing leak must be corrected: `allow_all` currently travels inside opaque `TurnConfig.options`. Trust is not a backend model control and should have its own field or module.

---

## Target architecture

```text
                              mobile
                                │
                                ▼
                     Agent catalog snapshot
                 installed agents + accounts + choices
                                │
               ┌────────────────┼────────────────┐
               ▼                ▼                ▼
          Pi harness       Account login     Native controls
          adapter          adapters          discovery adapters
               │                │                │
               └────────────────┴────────────────┘
                                │
                         installed agent CLI
```

Internally, execution, login, and discovery remain separate adapters because they vary independently. Externally, mobile consumes one Agent catalog so identity and availability are not reconstructed from parallel registries and routes.

The existing Normalized Conversation Protocol remains the conversation event seam.

---

## Track A — Thin Pi harness

### Scope

Add Pi as a runnable peer agent. Do not make it wait for new authentication or controls infrastructure.

### Protocol

- Extend `AgentName` with `'pi'`.
- Pi initially returns a minimal capability manifest:

```ts
{
  agent: 'pi',
  models: [],
  defaultModel: null,
  controls: [],
}
```

Empty choices mean “use Pi's native defaults,” not “Pi is unsupported.”

### Adapter

Add:

- `apps/backend/src/adapter/pi.ts`
- `apps/backend/src/adapter/pi-map.ts`

Run `pi --mode json` per turn, matching the existing Codex process pattern. Do not add a Pi npm dependency.

Map Pi JSON events to `AdapterEvent`:

- `session` → capture native session id; no emitted conversation event.
- assistant `message_update` / `text_delta` → `text_delta`.
- assistant `message_end` → final `text` when needed by the existing transcript behavior.
- `tool_execution_start` → `tool_call`.
- `tool_execution_end` → `tool_result`.
- `turn_end` → `turn_complete`.
- terminal retry failure or abnormal process close → recoverable `error` followed by a completed/idle transition consistent with other process adapters.

Deduplicate tool lifecycle events by native tool-call id.

### Resume and handoff

- Capture the id from Pi's `session` header.
- Resume a known conversation with `pi --session <id>`.
- Add `buildHandoffCommand('pi', sid)`.
- Add Pi to session discovery only after its on-disk JSONL format is covered by fixtures. Returning no discovered sessions in the first Pi release is acceptable; explicit Trux-created session resume is required.

### Authentication behavior

Pi uses whatever login or credentials the installed Pi CLI already owns. Trux does not write `~/.pi/agent/auth.json` in Track A.

If Pi is not authenticated, surface the native process error with a mobile action leading to Connections. Do not replace it with a curated list of API-key vendors.

### Approval behavior

Pi has no native approval protocol. `respondApproval` is a no-op and the capability is presented honestly. Trux must not imply that Pi executions are approval-gated.

### Track A tests

- Event-by-event Pi mapping fixtures.
- Session-id capture.
- Tool event deduplication.
- Spawn flags for new and resumed sessions.
- Process close/error behavior.
- Handoff command.
- Existing agent regression suite.

Track A is independently shippable.

---

## Track B — Agent catalog and multiple accounts

### Problem

The backend currently registers `AgentAdapter`s and `Authenticator`s in separate maps. Mobile queries agent capabilities and connection providers separately and reconstructs their relationship. Adding Pi's internal providers to both authentication and controls would duplicate identity again.

The current `Authenticator` also represents one connection status per id. That cannot express multiple accounts for one agent.

### Direction

Introduce an **Agent catalog module** as the single mobile-facing source of agent availability. It composes existing execution adapters with account/login and capability-discovery adapters internally.

Do not collapse all implementations into one large class. Consolidate the public catalog and registration; retain internal seams where there are at least two real adapters.

Illustrative response shape, finalized during implementation:

```ts
interface AgentCatalogEntry {
  agent: AgentName
  installed: boolean
  runnable: boolean
  accounts: AgentAccount[]
  capabilities: AgentCapabilities
  diagnostics?: AgentDiagnostic[]
}

interface AgentAccount {
  id: string
  agent: AgentName
  label: string
  kind: 'subscription' | 'api_key' | 'environment' | 'native'
  status: AuthStatus
  selected: boolean
}
```

The exact interface is intentionally not locked until the existing Claude, Codex, opencode, and Pi login behaviors are tested against it.

### Account identity

- Account ids must be stable and opaque to mobile.
- A conversation may persist an optional `account_id`.
- `null` means “agent-native/default account.”
- Account selection is separate from `TurnConfig.options`.
- Do not expose or persist credential material in the Trux database or protocol.

### Native login orchestration

Use existing native flows:

- Codex: device authorization.
- Claude: setup-token / paste-code flow.
- opencode: its native supported subscription login or credential store behavior.
- Pi: interactive `/login` output relayed through a terminal/session adapter where feasible.

The phone must be able to:

1. begin login,
2. open or copy the verification URL,
3. copy/show a device code,
4. paste a returned code when required,
5. observe pending/connected/expired/error state,
6. disconnect one chosen account.

When a CLI supports only an interactive terminal login, reuse Trux's phone-to-box terminal channel rather than scrape every prompt into a permanent protocol prematurely.

### API-key fallback

API-key entry is exposed only when supported by that agent/login adapter. If an agent accepts keys for many underlying vendors, vendor choice belongs inside that adapter's login flow; it does not become the global Agent catalog model.

Writes to native auth files require:

- preservation of unrelated entries;
- atomic write where practical;
- mode `0600`;
- injected filesystem adapter tests;
- no credential contents in logs, errors, events, or SQLite.

### Migration strategy

1. Add the Agent catalog alongside the current `/agents` and `/auth` routes.
2. Move mobile Connections and new-conversation loading to the catalog.
3. Adapt existing authenticators behind the catalog.
4. Remove duplicated public routes only after all mobile callers and tests migrate.

Avoid a flag-day rewrite.

### Track B tests

- Catalog with installed/uninstalled agents.
- Zero, one, and multiple accounts per agent.
- Two agents using different native login modes.
- One agent with subscription and API-key fallback.
- Selection and disconnection of one account without affecting others.
- Credential redaction.
- Mobile Connections states on narrow screens.

Track B is independently shippable and does not block Pi execution.

---

## Track C — Agent-neutral native controls

### Keep the generic renderer

Retain `AgentCapabilities`, first-class `model`, opaque native controls, and the shared mobile renderer. This is the correct part of the unified-controls design.

The frontend must not contain Claude-, Codex-, opencode-, or Pi-specific control widgets.

### Separate trust from native controls

Move `allow_all` out of `TurnConfig.options`.

Use a distinct trust selection, for example:

```ts
interface TurnConfig {
  model: string | null
  options: Record<string, string>
  trust?: TurnTrust
}

type TurnTrust = 'ask' | 'allow_all'
```

The final naming should align with the existing approval decisions, but the invariant is fixed: trust is interpreted by Trux; native options are interpreted only by the selected agent adapter.

### Capability discovery

Prefer capability discovery in this order:

1. installed CLI command or supported SDK interface;
2. connected account/provider metadata already exposed by the CLI;
3. short-lived cached last successful result;
4. empty manifest and native default.

Do not add a hand-maintained Pi model list. Do not require every agent to reach equal discovery depth before it can run.

Each discovery adapter defines its cache duration and failure behavior internally. Capability fetch failure must not make conversation creation unavailable.

### Per-agent work

- **Claude:** retain the current live discovery/cache behavior, but verify that it reflects Claude Code choices available to the connected subscription rather than treating the general Anthropic Models endpoint as authoritative when those differ.
- **Codex:** investigate the installed CLI's model and reasoning introspection. Populate only choices that can be discovered or authoritatively derived from the installed version/account.
- **opencode:** use its native provider/model discovery. Do not duplicate opencode providers in Trux.
- **Pi:** use Pi's native model listing after an account/login context is available. Provider remains an opaque Pi-native control only if Pi requires it at execution time.

### Persistence

- Continue sticky per-conversation model and native options.
- Add optional sticky `account_id` through a forward-only migration.
- Persist trust separately from opaque options if trust is conversation-sticky.
- Validate a submitted selection against the latest manifest when possible.
- If a previously selected model disappears, show it as unavailable and fall back to native default only after explicit user confirmation or at execution with a clear error. Do not silently rewrite history.

### Mobile interaction

The compact new-conversation flow is:

1. project/worktree,
2. agent,
3. account only when there is a meaningful choice,
4. optional model/native controls behind progressive disclosure,
5. start.

The composer shows the current model/control summary in one compact row. Trust is presented separately because it changes the safety contract.

Controls must remain usable one-handed and must not turn the composer into a settings screen. Empty manifests render no extra controls.

### Track C tests

- Generic rendering of arbitrary model + N controls.
- Empty manifest behavior.
- Discovery success, cache, expiry, and failure fallback.
- Account-dependent capabilities.
- Native option pass-through without frontend interpretation.
- Trust never appears in native options.
- Sticky model/account/control restoration.
- Stale selection behavior.

Track C can deepen one agent at a time.

---

## Delivery sequence

### Phase 1 — Pi can run

1. Extend protocol agent name.
2. Add Pi event mapper and fixtures.
3. Add Pi process adapter.
4. Register Pi and add resume/handoff.
5. Ship with an empty manifest and native credential use.

**Exit criterion:** from the phone, a user already logged into Pi on the box can create, continue, interrupt, and hand off a Pi conversation.

### Phase 2 — Correct the existing controls seam

1. Extract trust from `TurnConfig.options`.
2. Update manager, Claude adapter, mobile picker, persistence, and tests.
3. Preserve existing conversation compatibility during migration.

**Exit criterion:** native controls are opaque agent data; Trux trust is separately typed and rendered.

### Phase 3 — Agent catalog

1. Inventory installed agents and current native login states.
2. Introduce catalog composition over existing registries.
3. Move Connections and new-conversation mobile flows to the catalog.
4. Add stable account identity and optional conversation `account_id`.
5. Support multiple accounts without exposing secrets.

**Exit criterion:** mobile obtains installed agents, connection states, accounts, and capabilities from one catalog response.

### Phase 4 — Subscription login depth

1. Keep Codex and Claude device/code flows working through the catalog.
2. Add opencode's native subscription flow.
3. Spike Pi `/login` through the existing terminal channel.
4. Add a specialized Pi login adapter only if the terminal flow cannot provide a good mobile experience.
5. Retain API-key fallback per agent.

**Exit criterion:** a new user can connect their common coding-agent subscriptions from the phone without first obtaining API keys.

### Phase 5 — Capability depth

1. Verify Claude discovery against subscription-visible choices.
2. Add Pi native discovery.
3. Add Codex native discovery.
4. Add opencode native discovery.
5. Improve agents independently as their native interfaces permit.

**Exit criterion:** each supported agent either exposes current native choices or honestly runs with native defaults; no static Trux model catalog is required.

---

## Explicit non-goals

- A universal model/provider manager.
- A Trux-normalized reasoning or effort scale.
- Static cross-agent model catalogs.
- Reimplementation of vendor OAuth.
- Requiring every agent to have identical permissions, controls, or resume behavior.
- Storing subscription tokens or API keys in the Trux database.
- Blocking basic harness support on polished login or capability discovery.
- Treating Pi's provider taxonomy as Trux's domain model.

---

## Architecture checks

Before merging each phase, apply these checks:

1. **New-agent check:** can another CLI be added without editing mobile agent-specific UI?
2. **Multiple-account check:** can two subscriptions coexist without overwriting identity or credentials?
3. **Native-default check:** can the agent run when discovery returns no choices?
4. **Mobile check:** can the main path be completed on a narrow phone without opening a desktop terminal?
5. **Credential check:** can logs, events, SQLite, and error responses be shown to contain no secrets?
6. **Deletion check:** if the Agent catalog is deleted, does identity/capability composition reappear across multiple callers? If not, it is too shallow.
7. **Seam check:** retain an adapter seam only where two implementations genuinely vary.

---

## Final recommendation

Start with Phase 1 only. Pi should be a small, independently shippable harness addition.

Then correct the trust leak before expanding controls. Build the Agent catalog from observed Claude, Codex, opencode, and Pi login behavior, not from Pi's list of providers. This keeps Trux aligned with its core purpose: a mobile cockpit for whichever coding agents and subscriptions the user already has.
