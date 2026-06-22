# Authenticator — Phase 0 Headless-Login Spike — Findings

**Date:** 2026-06-22
**Spec:** `2026-06-22-provider-authenticator-design.md` (Phase 0)
**Question:** Can each agent's native subscription login run **without a same-machine browser** (the box has no browser; the phone's browser can't reach the box's `127.0.0.1` callback)? Per agent, which strategy applies — **(a) device/paste-code** or **(b) capture-and-sync** — and what is the exact credential destination?

**Method:** probed the real CLIs installed on this box (claude 2.1.177, codex-cli 0.141.0, opencode 1.17.9): help/flags, `auth status`, and credential-store shapes (keys only, secrets redacted). No interactive logins were completed. **Caveat:** running `codex login --device-auth </dev/null` *logged codex out* (it deletes/rewrites `~/.codex/auth.json` on start) — login subcommands mutate state even when they can't complete. Re-auth with `codex login`.

---

## Result: strategy (a) works for all three — (b) capture-and-sync is NOT needed

The localhost-redirect problem is **avoided** because every agent CLI offers a device/paste-code path that prints a URL the phone can open and accepts the result without a callback to the box.

| Agent | Headless mechanism (strategy a) | Key/token fallback | Credential destination |
|---|---|---|---|
| **Codex** (OpenAI) | `codex login --device-auth` — **first-class, explicitly named device flow** | `codex login --with-api-key` / `--with-access-token` (both read stdin) | `~/.codex/auth.json` (single JSON; OAuth: refresh/access/expires/accountId) |
| **Claude** (Anthropic) | `claude setup-token` — "Set up a long-lived authentication token (requires Claude subscription)"; paste-code style (hung waiting for interactive input under `</dev/null`, consistent with a print-URL→paste-code flow) | `ANTHROPIC_API_KEY` env (or `apiKeyHelper`) | `~/.claude/.credentials.json` → `claudeAiOauth: { accessToken, refreshToken, expiresAt, scopes, subscriptionType, rateLimitTier }` |
| **opencode** | `opencode auth login -p <provider> -m <method>` — opencode drives each provider's own device/PKCE flow | per-provider key methods (e.g. `opencode-go`, deepseek use `{type,key}`) | `~/.local/share/opencode/auth.json` (per-provider object; OAuth providers store refresh/access/expires) |

---

## Cleanest first target for Phase 1: **Codex**

`codex login --device-auth` is the least ambiguous of the three — a named, dedicated device-auth flag (no "is this really headless?" guesswork), a stdin token/key fallback on the same command, and a single-file destination. It exercises the full relay + status lifecycle + model-plane delivery with the least surprise. (Claude `setup-token` is a close second but I couldn't fully observe its prompt sequence non-interactively; opencode's flow is per-provider and the most variable.)

## The relay substrate already exists

The box-side login is a long-running interactive process that prints a verify URL + (for paste-code) waits for a code. **trux already has the channel for exactly this**: the verification-channels **terminal PTY** (`terminal.ts` / `terminal-route.ts`). Phase 1's relay can either (i) run the login under the existing terminal channel and let the user complete it in the terminal pane, or (ii) add a thin `/auth/:provider/{begin,poll}` REST pair that spawns the login, scrapes the verify URL/user-code from its stdout, and relays just those to a purpose-built Connections screen. (ii) is the cleaner product surface; (i) is a near-zero-code fallback that works today.

## Caveats that shape Phase 1

- **Env API key shadows subscription creds.** On this box `claude auth status` reported `apiKeySource: ANTHROPIC_API_KEY` while `authMethod: claude.ai` — a present `ANTHROPIC_API_KEY` takes precedence over the OAuth store. The authenticator's `status()` must report *which* source is live, and provisioning a box must not silently set an env key that shadows a subscription the user just connected.
- **Login subcommands are destructive.** `codex login --device-auth` removed the existing `auth.json` immediately. `begin()` must assume it can invalidate the current session, so the UI should confirm before re-auth of a connected provider.
- **Does the Agent SDK read the CLI's OAuth store?** trux's claude adapter uses `@anthropic-ai/claude-agent-sdk`, not the `claude` binary. The CLI writes `~/.claude/.credentials.json`; Phase 1 must confirm the **SDK** reads that same store (vs only env). `claude --help` notes OAuth/keychain are read except under `CLAUDE_CODE_SIMPLE=1` (env-only) — so the default path should work, but verify with the SDK directly before relying on it.
- **Fly persistence.** Model creds must land on `/data` on a scale-to-zero Fly box and survive wake; refresh is the CLI/SDK's job, so the cred file just needs to persist.

## Bottom line

Phase 0's linchpin is resolved: **no agent requires a browser on the box.** Build the `Authenticator` framework as specced; start Phase 1 with **Codex (`--device-auth`)** end-to-end + its stdin-key fallback, reuse the terminal channel (or a thin scrape-and-relay REST pair) as the relay, and carry the four caveats above into the plan.
