# Provider Authenticator — connect model & machine providers from the phone — Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-06-22
**Scope:** A subsystem that lets a developer **authenticate providers from the phone** — model providers (so the agent on the box can run) and machine providers (so trux can provision boxes). **OAuth/subscription login is the primary, first-shipped path; API key is a secondary fallback.** Companion to the Fly cloud dev machine (memory: `trux-cloud-dev-machine-byo`); it generalizes the Fly "how does `claude` authenticate headlessly" open item (Task 8) into a reusable subsystem and is the precondition for phone-side provisioning. Decision record: memory `trux-authenticator-oauth-first`.

---

## Governing principles

**1. Subscription-first, key-secondary.** Developers use subscriptions (Claude Max / ChatGPT), not raw API keys — "api key is not dev friendly, not everyone uses it." So OAuth/subscription login is the must-have primary path; API-key paste is an alternate input on the same adapter (opencode's model). Any provider whose login can't be driven headlessly falls back to key-paste, never the reverse.

**2. ToS-safe native pairing — each agent authenticates only to its own provider, through that provider's own sanctioned client.** Grounded in how trux already runs each agent:
- **Claude ↔ Anthropic** — the Agent SDK (`adapter/claude.ts:1,268`) reads `ANTHROPIC_API_KEY` *or* the Claude Code credential store; subscription auth means those OAuth creds are present on the box.
- **Codex ↔ OpenAI** — `spawn('codex')` (`adapter/codex.ts:15`) reads `~/.codex/auth.json`; subscription auth means `codex login` (ChatGPT) has run.
- **opencode ↔ its own** — `createOpencode()` (`adapter/opencode.ts:37`) reads opencode's own auth store via `opencode auth login`.

trux **never cross-routes** a subscription through a non-native tool (e.g. a Claude subscription through opencode). The native pairing is *why* this stays inside each provider's ToS — there is no grey area.

**3. Don't reimplement OAuth — orchestrate each agent's *native* login, headlessly.** Each agent CLI/SDK already owns the OAuth client, endpoints, credential file format, and **token refresh**. The authenticator's only job is to make that interactive login work over trux's **existing paired phone↔box WebSocket**: the box starts the native login → relays its authorize URL to the phone → the phone (a real browser) authenticates → the code/redirect returns to the box → the agent stores its own creds. trux re-implements none of it.

**4. Two credential planes — they never cross.** Model creds land on the **box** (the agent runs there); machine creds (Fly/GCP tokens) stay in the **control plane** (phone secure-store / `trux fly`). A compromised box can at worst burn model quota; it must not hold the keys to spawn infrastructure. This mirrors trux's existing rule that the auth boundary is the RCE boundary (`auth.ts:4`).

---

## Architecture overview

```
 phone (Connections screen)                          box (trux server)
   │  begin(connect claude)                             │
   │ ──────── REST /auth/:provider/begin ─────────────▶ │ Authenticator.begin()
   │ ◀─ {mode:'device', verify_url, user_code} ──────── │   → starts the agent's
   │  opens verify_url in the phone browser  ◀──────────┘     native login
   │  (user logs into Anthropic/OpenAI/…)               │
   │ ──────── poll /auth/:provider/status ────────────▶ │ Authenticator.poll()
   │ ◀──────── {status:'connected'} ─────────────────── │   creds stored by the
   │                                                     │   agent in its own store
   ▼                                                     ▼
 machine providers (Fly/GCP)                       model providers (Claude/Codex/opencode)
   creds → phone secure-store / control plane         creds → the box:
   (used to provision; never sent to a box)             claude: ANTHROPIC_* or Claude creds (SDK)
                                                         codex:  ~/.codex/auth.json
                                                         opencode: opencode auth store
                                                         (on Fly: persisted on /data)
```

**The `Authenticator` registry** parallels the agent registry (`registry.ts`, `adapter/types.ts`): one interface, an adapter per provider, surfaced as a "Connections" screen in the phone app. Shape:

```ts
type AuthMode =
  | { mode: 'device'; verifyUrl: string; userCode: string }   // relay URL → phone, box polls
  | { mode: 'apikey'; label: string }                          // secondary: paste, box stores
type AuthStatus = 'disconnected' | 'pending' | 'connected' | 'expired'

interface Authenticator {
  readonly id: string                 // 'claude' | 'codex' | 'opencode' | 'fly' | …
  readonly plane: 'model' | 'machine' // decides where the credential lands
  begin(): Promise<AuthMode>
  poll(): Promise<AuthStatus>         // device flow: box polls the provider
  submitKey?(key: string): Promise<AuthStatus>  // the key fallback
  status(): Promise<AuthStatus>
  disconnect(): Promise<void>
}
```

New backend surface (mirrors existing patterns): bearer-gated REST `begin/poll/status/disconnect` (added in the `routes.ts` scope, behind the `preHandler` token gate at `routes.ts:112`) plus, where a login needs a live relay, a WS channel modeled on `stream.ts` (auth-as-first-message). **Model** adapters write to the box's agent-cred location; **machine** adapters return the credential to the phone and never persist it on the box.

---

# Phase 0 — Headless-login spike (the linchpin, do first)

The one genuine unknown is whether each agent's native login can run **without a same-machine browser** (the localhost-redirect problem: the box has no browser; the phone's browser can't reach the box's `127.0.0.1` callback). Resolve it per agent **before** committing the framework, because it picks the strategy:
- **(a) Device / paste-code** — the login prints a URL + accepts a pasted code (no localhost callback). Preferred.
- **(b) Capture-and-sync** — the user logs in once on a device they already trust; trux securely copies the resulting cred file to the box and lets the agent refresh it there.

Spike deliverable: for **Claude** (does the Agent SDK accept an OAuth token / `claude setup-token`? or only `ANTHROPIC_API_KEY`?), **Codex** (`codex login` headless mode?), **opencode** (`opencode auth login` flow), record which of (a)/(b) works and the exact cred destination. Output is a one-page findings note that the Phase 1 plan consumes.

---

# Phase 1 — Authenticator framework + first subscription login end-to-end

The shippable first cut: the `Authenticator` registry + the "Connections" phone screen + **one agent's subscription login working end-to-end** (whichever the spike shows has the cleanest headless flow) + the **API-key fallback** on that same adapter. Proves the relay, the status lifecycle, and the model-plane credential delivery (including persistence to `/data` on a Fly box). Status surfaces in the UI as connected/expired so a turn never fails opaquely on missing auth.

---

# Phase 2 — Remaining agents, machine providers, and refresh

- **Remaining model agents** (the other two of claude/codex/opencode), each via its own native login behind the same interface.
- **Machine providers** — Fly first (`fly auth` / token paste → control-plane store, feeding the `trux fly` provisioner and the future phone-side control), then GCP (the OAuth flow from the BYO discussion).
- **Expiry + refresh** — surface `expired`, trigger re-auth; on a scale-to-zero Fly box, ensure refresh tokens persist on `/data` and refresh on wake.

---

## Non-goals

- **No reimplementing provider OAuth.** We orchestrate each agent's native login and store nothing we don't have to; refresh is the provider client's job.
- **No cross-provider routing.** Each agent authenticates only to its native provider (ToS). No "Claude via opencode."
- **No trux-hosted auth broker.** Consistent with the no-trux-service stance: the box (model plane) and the phone/control plane (machine plane) hold creds; trux runs no credential server in the middle.
- **No machine creds on boxes.** A box never holds the keys to provision boxes.
- **No new agent semantics.** Adapters are unchanged except that they now find valid creds where they already look.

---

## Open items resolved at plan time (Phase 0 feeds these)

- **Exact headless mechanics per agent** — Claude (Agent SDK token acceptance vs `ANTHROPIC_API_KEY` vs `claude setup-token`; the precise creds path the SDK reads), Codex (`codex login` headless), opencode (`opencode auth login`). Picks strategy (a) vs (b) per agent.
- **Relay channel** — reuse a WS like `stream.ts` vs a dedicated `/auth/:id/stream`; and whether device begin/poll is plain REST (likely yes).
- **Credential storage** — encryption at rest on the box; on Fly, `/data` persistence + the auto-stop/refresh interaction.
- **Machine-provider scope** — Fly tokens are org-wide (blast radius); document and scope as tightly as the provider allows.
- **Capture-and-sync transport** — if (b) is needed, how the cred file is moved from the trusted device to the box without a trux server in the middle (e.g. over the paired WS, encrypted, never logged).
