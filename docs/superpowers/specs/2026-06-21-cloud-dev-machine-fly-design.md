# Cloud Dev Machine — Fly Driver (driver #2) Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-06-21
**Scope:** Add a **Fly.io** path that stands trux up on always-on cloud compute the phone pairs to — a "cloud dev machine" so you can code on the go *without your own computer being on*. **Local stays driver #1, untouched.** We add Fly **concretely, alongside** the existing install path; the unified `ComputeDriver` abstraction is **explicitly deferred** (Phase 3 — extracted later from two real, working implementations, never guessed from one). BYO Fly account: the user's own app, own credit, own model/repo credentials — **no trux relay or backend in the path**. Realizes the "provision a dev machine in the cloud" exploration (memory: `trux-cloud-dev-machine-byo`, 2026-06-21).

---

## Governing principle: the box is the same — only birth and reach differ

Two ideas drive every decision below.

**1. The trux *server* is identical on a laptop and on Fly; backends differ on exactly two axes.** trux today is an agent runtime that binds a port (`TRUX_HOST:TRUX_PORT`, `deploy/provision.sh:50-51`) with **in-band token auth** (`TRUX_SECRET`, `provision.sh:48-49`). Nothing about that changes in the cloud. What a backend actually owns is:
- **(a) Lifecycle / birth** — how the box + service come to exist and how they start/stop. Local: `install.sh` → `provision.sh` → a **systemd --user** unit (`deploy/trux.service.template`, `provision.sh:109`), managed by `bin/trux` (`systemctl --user …`, `bin/trux:26-32`). Fly: a **Docker image** + `fly.toml` + the Machines API.
- **(b) Reachability + TLS** — how the outside reaches that port. Local: **`tailscale serve`** terminates TLS on the tailnet host and proxies to `127.0.0.1:4317` (`provision.sh:68-81`). Fly: Fly's **built-in Anycast TLS proxy** (`https://<app>.fly.dev`) forwards to the machine's internal port — no Tailscale, no public-IP/firewall/cert work (the user's "public, outside NAT, Tailscale not needed" point, realized for free).

Everything else — the server, `@trux/protocol`, the token model, the `#token=` / QR pairing flow, the phone client — is shared and untouched.

**2. Build the second driver, don't abstract it yet.** It is tempting to define a `ComputeDriver` interface now and implement local + Fly against it. We don't: premature abstraction over a single prior example (local) produces the wrong seams, and the two backends are *maximally different* (an always-on managed-process box vs. a power-cycled, API-provisioned, scale-to-zero box). So we ship Fly as its **own concrete path**, leave the local path byte-for-byte unchanged, and **extract `ComputeDriver` in Phase 3 from the two working implementations**. Per-cloud generalization (GCP/AWS) rides on that extraction, not before it.

> **Sovereignty dial, made concrete.** This adds the *vendor* point to the spectrum — `local (sovereign, free, must be on) ↔ Fly (trust-the-vendor, always-on, smooth)`. Fly's **scale-to-zero + wake-on-request** (below) is what specifically retires the "box must be on + reachable" footgun that local can't escape. Model locality stays the dial-setter: the user brings their own Claude credential, so hosting the *compute* on Fly doesn't move the sovereignty needle on the *data/model*.

---

## Architecture overview

```
            phone (Expo app)  /  browser (Vite PWA)        ← unchanged client
                      │  pair: https://<host>/#token=<secret>
        ┌─────────────┴─────────────┐
        ▼                           ▼
  tailscale serve              Fly Anycast TLS proxy        ← reachability (per backend)
  (tailnet host → :4317)       (https://<app>.fly.dev → internal_port)
        │                           │  auto_start on request / auto_stop when idle
        ▼                           ▼
  trux server :4317            trux server :4317  (TRUX_HOST=0.0.0.0)   ← IDENTICAL
  (systemd --user)             (Docker entrypoint, Fly machine)
        │                           │
        ▼                           ▼
  $HOME workspace              /data volume  (repo + agent state, survives stop)
  claude CLI (local login)     claude CLI  ←  ANTHROPIC creds via Fly secret
```

**What each backend owns:**

| Concern | Local (driver #1, unchanged) | Fly (driver #2, NEW) |
|---|---|---|
| Birth / image | `provision.sh`: pnpm install + `frontend build`, write `~/.trux/.env` | **Docker image** bakes node 22 + pnpm + trux + built frontend + `claude` CLI |
| Service lifecycle | systemd `--now` unit; `bin/trux start/stop/restart` | Fly machine; `fly.toml` `auto_stop_machines="stop"` / `auto_start_machines=true` / `min_machines_running=0` |
| Reachability + TLS | `tailscale serve` → `127.0.0.1:4317` | Fly proxy → internal `:4317`, `TRUX_HOST=0.0.0.0` |
| Secrets | `~/.trux/.env` (0600), `TRUX_SECRET` via `openssl rand` | **Fly secrets**: `TRUX_SECRET`, `ANTHROPIC_API_KEY`, repo token |
| Persistence | the user's real `$HOME` | **Fly volume** mounted at `/data`, `TRUX_WORKSPACES=/data` |
| Repo | already on disk | **clone on first boot** using injected repo token |
| Pairing host | `TRUX_TAILSCALE_HOST` (`bin/trux:39-41`) | `<app>.fly.dev` (generalize → `TRUX_PUBLIC_HOST`) |

**The one small shared refactor** is the pairing-URL host: today `bin/trux url` and `pair.ts` build the URL from `TRUX_TAILSCALE_HOST`. Generalize to a neutral `TRUX_PUBLIC_HOST` (local keeps setting it from Tailscale; Fly sets it to the `.fly.dev` host), backward-compatible. This is the *only* edit to shared code.

---

# Phase 1 — A Fly box you can stand up and pair to

The shippable first cut: one command stands up an always-on (scale-to-zero) trux on the user's Fly account, and the phone pairs to it exactly like a local box. Bootstrap is **CLI / one-time** (from a computer, or Fly's dashboard); ongoing use needs no computer because Fly auto-starts the machine on the next request. This delivers the headline value — *code from your phone without your computer on*.

## 1.1 The trux Docker image
A `Dockerfile` (+ `.dockerignore`) baking node 22, pnpm, the trux repo, a built frontend (`pnpm --filter frontend build`, replacing `provision.sh`'s build step), and the `claude` CLI. Entrypoint = the trux server (`pnpm --filter backend start`) bound to `0.0.0.0:4317`. No systemd — the Fly machine *is* the supervisor (`fly.toml` restart policy).

## 1.2 `fly.toml` — reachability, lifecycle, persistence
- `[http_service]` `internal_port = 4317`, `force_https = true`, `auto_stop_machines = "stop"`, `auto_start_machines = true`, `min_machines_running = 0` → **TLS + scale-to-zero + wake-on-request** out of the box.
- `[mounts]` a Fly **volume** at `/data`; `TRUX_WORKSPACES=/data` so the repo + agent state survive stop/restart.
- A small default machine (shared CPU, ~1–2 GB) with the size + region surfaced as launch flags.

## 1.3 First-boot configuration (the entrypoint)
On boot the entrypoint: ensures `/data` has the repo (clone via injected repo token if absent), materializes the `~/.trux/.env` equivalent **from Fly secrets/env** (`TRUX_AUTH=1`, `TRUX_SECRET`, `TRUX_HOST=0.0.0.0`, `TRUX_PORT=4317`, `TRUX_WORKSPACES=/data`, `TRUX_PUBLIC_HOST=<app>.fly.dev`), then starts the server. Idempotent across auto-start wakes.

## 1.4 `trux fly` — the provisioning path
A thin command (likely a `bin/trux` subcommand or sibling script) that wraps the Fly bootstrap so a non-coder runs **one** command, not a `flyctl` sequence: create app + volume, `fly secrets set` (`TRUX_SECRET` via `openssl rand -hex 32`, `ANTHROPIC_API_KEY`, repo token), deploy the image, and **print the pairing QR** for `https://<app>.fly.dev/#token=<secret>` (reuse `pair.ts`, pointed at `TRUX_PUBLIC_HOST`). Mirrors what `provision.sh` does locally, for Fly.

## 1.5 Phase 1 testing
- **Image:** builds; entrypoint clones the repo, writes env from secrets, server answers `/config` on `:4317` inside the machine.
- **Reachability:** `https://<app>.fly.dev` serves over TLS; in-band token auth accepts `TRUX_SECRET`, rejects others (parity with local).
- **Lifecycle:** machine `auto_stop`s when idle; a request **auto-starts** it; `/data` (repo + a written file) survives a stop/start cycle.
- **Pairing:** the QR encodes the `.fly.dev` host + token; the unchanged phone client pairs and runs a turn end-to-end.
- **Local untouched:** the existing install/`provision.sh`/`bin/trux` suite stays green; `TRUX_PUBLIC_HOST` generalization is behavior-preserving for Tailscale installs.

---

# Phase 2 — Phone-side lifecycle control (optional, next)

So provisioning *also* needs no computer. The Expo app (with the user's Fly API token in secure-store) lists the user's trux machines and offers start / stop / destroy + a cost/region readout — calling the **Fly Machines REST API directly from the client** (same no-trux-backend, client-as-control-plane model as the native app's direct-WS transport). Phase 1's `auto_start` already covers the common "wake it" case, so this is a control/visibility upgrade, not a prerequisite. Gated on Phase 1 + the native app's host-management surface.

---

# Phase 3 — Extract the `ComputeDriver` abstraction (deferred)

Only now, with **two** real, divergent backends (local managed-process vs. Fly scale-to-zero), extract the interface from what actually shipped — `provision / list / status / start / stop / destroy / endpoint`, with **capability flags** so the UI hides verbs a backend lacks (e.g. local has no "wake from off"). This is where GCP/AWS become *additional drivers* rather than forks. Listed to fix the destination; **execution is a follow-on**, explicitly not part of this spec.

---

## Non-goals

- **No abstraction yet.** No `ComputeDriver` interface in Phase 1/2 — extracted in Phase 3 from two working drivers, never guessed from one.
- **No trux service / relay / multi-tenancy.** BYO Fly account, the user's own app + credit + credentials. trux stays a pure enabler, not a hosted product (the rejected SaaS angle).
- **No change to the trux server, `@trux/protocol`, the token model, or the local path.** The sole shared edit is `TRUX_TAILSCALE_HOST` → `TRUX_PUBLIC_HOST` (backward-compatible).
- **No GCP/AWS here.** Fly first; other clouds ride on the Phase 3 abstraction.
- **No new transport.** Reachability is Fly's proxy + the existing in-band token auth — no Tailscale required on the cloud box, no relay.

---

## Open items resolved at plan time (not design unknowns)

- **Model credential.** Inject Claude auth as a Fly secret — `ANTHROPIC_API_KEY` (simplest) vs. mounting `claude` OAuth creds. The sovereignty dial lives here; confirm the form the bundled agent expects.
- **Repo auth.** Clone/push for private repos: a fine-grained **PAT** / deploy key as a Fly secret (MVP) vs. a GitHub App (smoother, later). Decide MVP form + where it's stored.
- **Cold-start UX.** Auto-start wake adds a few seconds before the WS accepts; confirm `connectionManager` reconnect tolerates it and surface a "waking…" state in the client.
- **Machine defaults.** Size (CPU/RAM), region (near the user), volume size, and whether to show an estimated cost in `trux fly`.
- **`trux fly` mechanism.** Wrap **`flyctl`** (requires it installed) vs. call the Fly **Machines REST API** directly (no dep, and reusable by Phase 2's phone-side control). Leaning REST for the eventual native port.
- **Secret generation point.** `TRUX_SECRET` minted by `trux fly` (`fly secrets set`) vs. by the entrypoint on first boot — pick one canonical owner so pairing and the server agree.
- **Attribution / image base.** Pin the base image + node version; keep the image build reproducible alongside `provision.sh`.
