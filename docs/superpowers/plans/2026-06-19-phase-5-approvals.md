# Phase 5 — Pinned graduated approvals (plan)

Spec: `docs/superpowers/specs/2026-06-17-trux-v2-design.md` §3.5, P1 rows "Pinned approval banner" / "Structured approval presentation" / "Graduated approval scopes + optimistic per-button state", phase list "Phase 5".

**Goal:** A blocking decision is unmissable and answerable in one thumb without reading JSON. Pinned above the composer, structured presentation (the one command/file in copper mono), graduated trust buttons, optimistic per-button state.

## Protocol addition — graduated decision scopes

Today `ApprovalDecision = 'allow' | 'deny' | 'allow_always'`. Add two scopes:
- `allow_edits` — allow this + flip Edit/Write/MultiEdit to auto-approve for the session.
- `allow_command` — allow this Bash + pin the exact command string as a session rule (future identical commands auto-allow).

Thread through: `events.ts` (union + `parse.ts` DECISIONS), `claude.ts` `canUseTool` (mode-flip / command pinning), and the manager passes the decision through unchanged (already does). The Claude SDK `canUseTool` returns `{behavior:'allow'|'deny'}` per call; the adapter holds session state (`editsAllowed`, `allowedCommands:Set`) and short-circuits a parked/future approval that matches.

## Tasks (TDD, per-task commit)

1. **Protocol: graduated decision scopes** (`events.ts`, `parse.ts`, protocol test). Extend the `ApprovalDecision` union + parser DECISIONS. Test parse accepts the new values, rejects junk.
2. **Claude adapter: scope handling** (`claude.ts`, `claude.test.ts`). Session state: `editsAllowed`, `allowedCommands`. `respondApproval`:
   - `allow_edits` → resolve allow + set editsAllowed; future Edit/Write/MultiEdit approval requests auto-resolve allow (in `requestApproval`, before parking).
   - `allow_command` → resolve allow + add `input.command` to allowedCommands; future Bash with the same command auto-resolves.
   - Existing allow/deny/allow_always unchanged. Tests: allow_edits auto-approves a later Write; allow_command auto-approves the same command, still prompts a different one.
3. **Structured ApprovalCard presentation** (`ApprovalCard.tsx`, `tools.ts`, components test). Title + the one approved thing (copper mono via `toolSummary`) + expandable raw `<details>`. Graduated buttons by tool family: Edit/Write/MultiEdit → Allow + Allow all edits; Bash → Allow once + Allow this command; always Deny. Optimistic per-button: clicked button lit, siblings dim, spinner while in flight (decision recorded in store already).
4. **Pinned approval above composer** (`ConversationView.tsx`, `index.css`, components/App test). When `status === 'awaiting_approval'`, find the latest unresolved approval (in transcript, no recorded decision) and render a pinned `ApprovalCard` just above the composer. Entrance animation + arrival haptic already fire (haptics on approval_request). The in-transcript card stays but the pinned one is the actionable one; clicking either records the decision and removes the pin. Honor `prefers-reduced-motion`.

## Notes
- `onRespond` in ConversationView already sends decision + records it; just widen its type.
- The pinned card must not render a dead button when control is contended — out of scope for v1 (single-owner), keep simple.
