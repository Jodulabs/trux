# Trux v2 — Design Spec

*The field console, finished. Steering artifact for the v2 build. Supersedes the phase-6.7 open-issues log (those P0 fixes are folded in below as Phase 0).*

*Stack stays: React + Vite + Zustand + `ws`, Fastify backend, SQLite registry, the NCP event protocol. No rewrite. Every change below maps to a file that exists today.*

---

## 1. Vision — what Trux v2 feels like in the hand

You kick off an agent from your phone, lock the screen, and put it in your pocket. Ten minutes later your phone taps you on the shoulder: *"trux · approval needed — Bash: rm -rf dist/."* You glance, the decision is already on screen above your thumb, you tap **Allow once**, and pocket it again. When you open the app the transcript is exactly where you left it — no dead screen, no lost prompt, no wall of tool noise. You scroll up to read what it did; the stream doesn't yank you back down. You find a command in its reply, tap once, it's copied. You review the diff it wrote in a real full-width view, commit it with the suggested message, and you never touched a terminal.

Trux v2 is the difference between a **styled chat that works at the desk** and **an instrument you trust from your phone while the agent runs.** Three things make that real, in order: the conversation must *feel alive and stay where your eyes are*, it must *never silently die*, and it must *reach out when it needs you*. Everything else hangs off that spine.

The character is a calm, machined field instrument — not a toy, not a flashy consumer chat app. It happens to fit in one hand.

---

## 2. Aesthetic & character — deepen the field console, don't restyle it

The ink + warm-copper IBM-Plex "field console" in `index.css` already has a real point of view. v2 adds capability *inside that language* rather than repainting.

- **Palette unchanged.** Ink surfaces (`--ink #0c0d10`, layered `--surface-1..3`), warm copper signature accent (`--accent #e8843d`). Copper is reserved for **liveness and the assistant's voice** — the streaming caret, the breathing "needs-you" status dot, the assistant column rule, the one primary action. It is never sprinkled decoratively. Muted slate/grey for user turns and completed/idle work. A single reserved alert hue for offline / failed states.
- **Typography encodes human-vs-machine.** IBM Plex Sans for prose; IBM Plex Mono for everything the machine emits — tool names, commands, file paths, timers, code, connection state. Timers and counters use **tabular figures** so digits don't jitter width.
- **Depth, lightly.** Keep the existing radial copper sheen (`index.css:73`); add subtle 1px top-highlight borders on stacked panels (diff view, git panel, pinned approval, grouped tool clusters) so they read as physically layered, not flat fills.
- **Disciplined motion.** Promote ad-hoc transitions to tokens (`--ease`, `--dur-fast`, `--dur-slow`). Motion only ever signals a state change: the message `rise`, a single `pulse` on the awaiting-approval dot, a caret that breathes, a calm collapse of completed work, a copper dot that breathes (not a red alarm) while reconnecting. **Every animation — including the new caret blink — is gated behind `prefers-reduced-motion`,** which nothing honors today.
- **Standalone PWA polish.** Apply `safe-area-inset-top` to `.conversation-bar` so the status line clears the notch; the composer already handles `inset-bottom`.

---

## 3. The chat interface

The transcript is where the brand lives — on a phone watching a long turn, the things you feel every second are the substrate. Today `Transcript.tsx` is a plain flex column with no scroll ref, and assistant text renders as static markdown with no liveness cue.

### 3.1 Streaming feel
- **Streaming caret.** `store.ts foldEvent` already accumulates `text_delta` into the open `text` item. Render a copper block caret (`▍`) at the tail of the **latest** assistant text item while `status === 'thinking'`, fading out on `turn_complete`. The difference between "text is appearing" and "something is alive." Cheap, high signature value.
- **Sticky-but-polite autoscroll.** Add a scroll-container ref in `Transcript`/`ConversationView`; track `distanceFromBottom`. A `useLayoutEffect` keyed on transcript length scrolls to bottom **only when the user was already within ~80px of the bottom.** The instant they scroll up to read history, stop forcing. This is the single most-felt chat behavior and is entirely absent. Implement it correctly the first time: never run a JS scroll-to-bottom unconditionally.
- **Scroll-to-latest FAB.** A small circular copper-ringed button floats above `.composer` (respecting `safe-area-inset-bottom`), appearing only after scrolling ~300px up, with a subtle "new activity below" pulse when content lands while you're reading. Tap smooth-scrolls down and re-arms sticky autoscroll. **Gate its visibility through a ref** so the transcript parent doesn't re-render every 60Hz scroll frame.

### 3.2 Roles & message grouping
- Keep the existing user/assistant role distinction and the copper-ruled assistant column.
- Clamp message rows to a readable max-width centered column on wide screens (desktop is a real Trux surface too) rather than stretching edge to edge.

### 3.3 Code blocks + copy *(highest ROI single feature)*
`Markdown.tsx` is a bare `ReactMarkdown` — code blocks have no copy affordance, and manual multi-line selection on a phone is the worst interaction in the app. Add a **custom `code`/`pre` renderer**: a header strip with the **language label** (mono-faint) and a **copy button** (top-right) that calls `navigator.clipboard.writeText`, flashes "copied" in copper, and fires a light haptic. Keep react-markdown's no-raw-HTML default — agent output is untrusted-ish and emits HTML constantly; do **not** add `rehype-raw`.

### 3.4 Tool calls — from wall-of-boxes to one calm activity group
`Transcript.tsx` renders every `tool_call`/`tool_result` as its own `<details>`. At agent scale (dozens of Read/Grep/Bash per turn) this buries the actual prose answer. Introduce an **`ActivityGroup`** in the transcript reducer:
- Fold consecutive `tool_call`/`tool_result` items (between prose) into one collapsible cluster with a one-line header: a category glyph + `toolSummary()` (already exists in `tools.ts`) + a **live elapsed timer** in tabular mono ("Worked 12s · 6 steps").
- **Auto-collapse on `turn_complete`; expanded while running; auto-expand when a child needs approval.** Auto-collapse on tab-hidden (`visibilitychange`).
- **Never re-open a group the user manually collapsed** — track manual collapse separately from auto state. The UI must never fight the user's intent.
- Per-tool expansion state persists per `tool_id` so scrolling doesn't lose what you opened. Compress subagent (Task) chatter into a one-line summary row.

### 3.5 Approvals — pinned, structured, graduated, one-thumb *(the core control loop)*
`ApprovalCard.tsx` dumps `JSON.stringify(event.input)`, offers a flat allow/deny/always, and **scrolls away with everything else** — a blocking decision can scroll off-screen and strand the agent while the user has no idea it's waiting.
- **Pin the latest unresolved approval** as a sticky element just above the composer (or a "↓ decision waiting" banner that scrolls to it) while `status === 'awaiting_approval'`. A blocking decision must never scroll off-screen on a glanced-at phone.
- **Structured presentation, not JSON.** Parse the tool input into: title + **the one thing being approved** (the command / file path in copper mono) + an expandable raw section with light syntax tint. Reuse `tools.ts` summaries.
- **Graduated trust buttons.** For Edit/Write/MultiEdit: `Allow` + `Allow all edits`. For Bash: `Allow once` + `Allow this command` (pins the exact command string as the session rule). `Deny` always present. This needs a **small protocol addition** — richer `ApprovalDecision` scopes beyond `allow | deny | allow_always` (e.g. `allow_edits`, `allow_command`) threaded through `events.ts`, the manager's `handleApprovalResponse`, and the Claude adapter's `canUseTool` mode-flip.
- **Optimistic per-button state.** Each button shows its own spinner while its response is in flight; after resolution the chosen one stays lit (copper) and siblings dim to ~0.62 opacity so the decision history reads. `recordApproval` already tracks the chosen decision.
- **Entrance + haptic.** Animate the pinned approval in (a slightly stronger `rise`) and fire a notification haptic on arrival — you may have pocketed the phone.
- **Honest degraded control:** never render an interactive approval button that can't act. If control is contended (desktop terminal owns the turn), show a banner explaining who has the conn, not dead buttons.

### 3.6 Long-press / context actions
Long-press (touch) or right-click (pointer) any message → a bottom sheet. Start minimal: **Copy message** (covers 80%). Then add **Retry** on an assistant turn and **Edit & resend** on a user message (both map onto re-sending a `user_message`). Defer the full radial/share menu. 400ms long-press, bottom-sheet affordance.

---

## 4. Composer & mobile ergonomics

The cramped composer is the #1 logged issue and there's an **active bug**: `Composer.tsx:146` sends on Enter unless Shift is held — phone keyboards have no Shift, so you can never type a newline.

### 4.1 Two-row layout (fixes the cramp)
`.composer-field` today is one flex row holding the textarea + four icon buttons; on a narrow phone the icons claim the width and the textarea collapses to a sliver. Restructure:
- **Row 1:** full-width `<textarea>`, taller resting height (`min-height ~44px`), auto-grow to a cap (160px) preserved.
- **Row 2 (`.composer-actions`):** action chips left (snippet save/insert, attach — all already built; add indent/dedent since phone keyboards lack a usable Tab), a spacer, the round send/stop button pushed right with `margin-left: auto`.
- All `data-testid`s stay: `composer-input`, `send`, `interrupt`, `snippet-save`, `snippet-open`, `attach-image`, `file-input`.

### 4.2 Enter-key contract (the bug)
Detect coarse pointer via `matchMedia('(pointer: coarse)')` — **not** touch events (avoids false positives on touchscreen laptops). On coarse pointers: **Enter inserts a newline, the Send button submits.** On a hardware keyboard: Enter sends, Shift+Enter newlines.

### 4.3 One context-aware primary button (tap-interrupt / hold-stop)
Bottom-right, in the thumb zone (already good placement). Idle + text = **Send**; while the agent runs it becomes a red **stop** control where **tap = soft interrupt** (`adapter.interrupt()` exists) and **long-press = hard stop**, with distinct haptics ("tap interrupt, hold stop"). Enforce a **300ms minimum spinner** so a tap visibly registers over a laggy Tailscale link. Block-send and failed-abort give an error haptic + shake rather than a silent no-op.

### 4.4 Drafts, attachments, voice
- **Per-conversation drafts** (text + attachments) persisted to `localStorage`, keyed by conversation id, restored on return, with the temp-id → real-id migration when a new conversation gets its id. Clear on successful send. Show a pencil badge on sidebar rows with a draft. Mobile users are interrupted constantly; never lose a half-typed prompt.
- **Attachments** already work (image picker + base64). Harden: detect MIME from **magic bytes**, not the file extension — mobile pickers re-encode to JPEG while keeping a `.png` name and the Claude API rejects the mismatch. Make tool-result images tappable to a lightbox instead of the fixed `max-height: 70vh`.
- **Voice input** (deferred to P2): a mic button toggling Web Speech API speech-to-text, inserting at the cursor.

### 4.5 Ergonomics rules (apply throughout)
- **44px tap targets** on load-bearing controls (approval option buttons especially). The 36px `.icon-btn` glyphs can stay but expand tap padding toward 44px.
- **Everything load-bearing in the bottom thumb zone:** send/stop, pinned approval, scroll-FAB, conversation switcher. Nothing critical in the top corners; the transcript scrolls above.
- **Haptic feedback language** via `navigator.vibrate` (Android PWA; degrade gracefully on iOS Safari): light tick on send and copy, medium on interrupt/stop, a notification pattern on approval arrival and turn-complete. These close the loop exactly when you're not looking at the screen.
- **Keyboard avoidance:** the app uses `100dvh` but verify with the **`visualViewport` API** that the latest message and a pinned approval stay visible above the soft keyboard — `dvh` alone doesn't guarantee it. Drag on the transcript dismisses the keyboard; auto-scroll does not.
- **Honor `prefers-reduced-motion`** on rise/pulse/caret. Add ARIA labels to the status dot, tool names, and connection state.

---

## 5. Practical features, in priority order

### P0 — logged fixes (Phase 0, ship first)
These are small, high-friction, and block trust. From the open-issues audit:
1. **Cramped composer** → two-row layout (§4.1).
2. **Pair button useless on phone** — `Sidebar.tsx:42` always renders it. Hide on coarse-pointer devices (`matchMedia('(pointer: coarse)')`) and when there's no `tailscaleHost` + token. Pairing is a desktop→phone handoff; it's pure noise on the phone where you're already paired.
3. **`pnpm start` floods terminal with QR** — `index.ts:32` → `printAccessBanner` always renders the QR. Split into a compact `printStartBanner` (listening URL + Tailscale URL + "run `pnpm pair` for the QR") and keep the full QR in `pnpm pair`.
4. **`codex session list` errors on every probe** — `routes.ts:47` runs a removed subcommand; stderr leaks. Discover codex sessions from disk instead: walk `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, parse line 1 `session_meta`, filter `payload.cwd === cwd`, return newest 10. Drop the `execFileSync('codex', …)` entirely. Add a routes test with a temp fixture.
5. **Token-gate wall with no guidance** — `TokenGate.tsx` gives no hint. Add copy: "Your token is `TRUX_SECRET` in `~/.trux/.env`. On your phone, scan the QR from `pnpm pair` instead of typing it." (Do **not** trust loopback — `tailscale serve` proxies remote requests to `127.0.0.1`, so trusting loopback silently disables auth for everyone.)

### P1 — the load-bearing capability investments
6. **Resilient WebSocket + visible connection state.** `truxClient.ts` opens the socket once and never reconnects — the first phone sleep silently kills the conversation. Add capped exponential backoff (1/2/4/8/16/30s) and a **connection epoch** guard so stale-socket callbacks can't corrupt the new connection (a real, high-severity bug class). Surface `connected | reconnecting | offline` in the store, rendered as a quiet breathing-copper-dot morph in `.conversation-bar`.
7. **Seq-on-wire + delta catch-up on reconnect.** The registry already allocates a per-conversation `seq` (`registry.ts:115`) but it is **not** on the wire. Thread `seq` into streamed `ServerEvent`s via `manager.emit`/`stampTurn` (keep `text_delta` unsequenced — it's broadcast-only). Add a client→server `resume { since_seq }` handled in `stream.ts` after auth; the manager replies with a `history_delta` (events with `seq > since_seq`) or a `history_snapshot` if the gap is too large. The client caches last-seen `seq` per conversation in the store (persisted) and asks for exactly the deltas it missed instead of blindly refetching the full transcript. Cheap because the DB is already shaped for it; painful to retrofit later, so build it with reconnect.
8. **Optimistic send + persisted offline queue + ack.** Today the user's message only appears when the manager echoes `user_text` back (`manager.ts:83`); over a dead socket it vanishes with zero feedback. Add a `client_message_id` to `user_message` and an `input_ack` from the manager carrying the `seq` it landed at. Render the user bubble instantly (sending → sent → failed-with-retry). Queue outbound prompts/approvals to `localStorage` when offline, dedupe by `client_message_id`, auto-flush in order on reconnect with idempotent server-side handling.
9. **Web-push notifications (the reason to own a phone client).** Trux is a PWA, so this is web-push, and it must originate **server-side** (the app is closed most of the time). Add a `web-push` dep + a `/push/subscribe` route storing the subscription in SQLite; emit a push from the **manager** on `approval_request` and `turn_complete`, deduped per `request_id`/`turn_id`. `sw.js` has no `push`/`notificationclick` handlers today — add them; the payload carries `{conversationId, kind, title}` and `notificationclick` focuses the PWA and deep-links to the conversation. Add a **privacy mode** toggle that genericizes the body ("Approval required" / "Turn complete") since lockscreen previews leak code. Gate on `visibilityState` — suppress (haptic instead) when the PWA is foregrounded on that conversation.
10. **Diff / file / safe-git views (review & commit without leaving the phone).** Trux's edge over a terminal; every `tool_result` is a `<pre>` dump today. Detect `Edit`/`Write`/`MultiEdit` in `Transcript.tsx` and render a compact diff preview (filename + `+N/-M` gutter) that routes to a **dedicated full-width `DiffView`** (modal/route on mobile, side panel ≥640px — don't cram a wide diff into a narrow transcript). Add a `/conversations/:id/git` backend route running `git status --porcelain` / `git diff` / `git diff --staged` in the conversation `cwd`, a `GitPanel` to stage and **commit with an agent-suggested message**, and a dirty/ahead/behind badge in the conversation bar. **Safe ops only** — `status` / `add` / `restore --staged` / `commit`. **No** `reset --hard`, `push`, `rebase`, `checkout --` from the phone; a fat-finger there is unrecoverable.
11. **Multi-conversation flow (the multiplexer becomes the point).** `ConversationView` mounts one WS per `id` and tears it down on switch — only one conversation is ever live. Lift the socket to a store-level connection manager that holds the active conversation plus listens for status on others. Extend the existing sidebar status dots (`Sidebar.tsx:36`) with a solid-copper **unread** state (a backgrounded conversation produced output) and a pulsing **awaiting_approval** "needs-you" state — the "which agent is blocked on me" glance. Add a **bottom-anchored mobile quick-switcher** (the sidebar collapses to 38vh out of thumb reach).

### P2 — depth & polish
12. **Run status with elapsed time + current tool + rotating verb.** Upgrade the terse `STATUS_LABEL` into "Thinking… 0:14" / "Running pytest" / "Awaiting your approval," with a rotating whimsical verb on active states that doubles as a **liveness indicator** — a frozen verb signals a hung stream.
13. **Token/cost display.** `TurnCompleteEvent` already carries `usage` + `cost`; render a per-turn cost badge and a sidebar usage roll-up. No backend change.
14. **Conversation search in the sidebar.** The FTS5 `/conversations/search` endpoint exists; add a search input that calls it.
15. **Workspace picker that isn't a flat dump** (deferred in 6.7). `NewConversationDialog.tsx:59` flattens every worktree into one `<select>`. Group with `<optgroup>` per workspace root, sort most-recently-used, default to last-used repo; ideally a searchable typeahead.
16. **Conversation list polish:** last-message preview, last-active timestamp, sort/filter by recency/status/agent.
17. **Voice input** into the composer (§4.4).
18. **Pull-to-refresh** to resync transcript + bust the SW cache (the team already does this manually).

---

## 6. Phased implementation order

Each phase ends in something visible and testable on the phone. **Feel first** (cheap, pure-frontend, no protocol change, builds trust), **then the backbone** (reconnect/seq), **then the payoff** (push, diff/git), **then the multiplexer**, **then depth**. Character/craft (motion tokens, depth, status verbs, haptics) is woven through every phase, not a separate one.

- **Phase 0 — Logged P0 fixes.** Composer two-row + Enter-fix, pair button hidden on phone, split start/pair banners, codex disk-based session discovery, token-gate guidance. Bump `sw.js` cache version. *Testable: phone composer is usable and can type newlines; `pnpm start` is quiet; new-conversation dialog doesn't error.*
- **Phase 1 — Streaming feel & code.** Streaming caret, sticky-polite autoscroll, scroll-to-latest FAB, one-tap code-block copy, tool-call ActivityGroup, haptics, `prefers-reduced-motion`. Pure frontend, no protocol change. *Testable: a long agent turn reads cleanly and stays where your eyes are; you can copy a command in one tap.*
- **Phase 2 — Connection resilience.** Reconnect with backoff + epoch guard, visible connection state, optimistic send with sending/failed/retry. *Testable: sleep the phone mid-turn, wake it, the conversation heals instead of dying.*
- **Phase 3 — Seq protocol & offline queue.** Seq-on-wire, `resume{since_seq}` → delta/snapshot, `client_message_id` + `input_ack`, persisted deduped offline queue. *Testable: reconnect restores only missed deltas instantly; a prompt typed offline sends itself on reconnect.*
- **Phase 4 — Notifications.** Server-side web-push on approval/turn-complete, `sw.js` push + deep-link, privacy mode, lifecycle gating. *Testable: pocket the phone, get tapped on the shoulder when the agent needs you, tap through to the right conversation.*
- **Phase 5 — Pinned graduated approvals.** Pinned structured approval card, graduated decision scopes (protocol addition), optimistic per-button state. *Testable: a blocking decision is unmissable and answerable in one thumb without reading JSON.*
- **Phase 6 — Diff / file / git.** Edit cards → full-width DiffView, `/git` route, GitPanel with safe ops + AI commit message, dirty/ahead/behind badge. *Testable: review and commit the agent's work end-to-end from the phone.*
- **Phase 7 — Multiplexer.** Store-level connection manager, unread + needs-you roster, bottom quick-switcher, per-conversation drafts. *Testable: run two agents, see at a glance which one is blocked on you, switch without losing a draft.*
- **Phase 8 — Depth & polish.** Status timer + rotating verb, cost/usage display, conversation search, workspace picker grouping, list previews, voice, pull-to-refresh.



## 7. Prioritized change list

 | Tier | Change | Effort | Files |
 |---|---|---|---|
| P0 | **Composer two-row layout (fix cramp)** — Textarea + 4 icons on one flex row collapse the input to a sliver on a phone. Stack into textarea row + actions row; send/stop pushed right. | M | `apps/frontend/src/components/Composer.tsx, apps/frontend/src/index.css (.composer-field, new .composer-actions)` |
| P0 | **Fix Enter-key contract on touch** — Composer.tsx:146 sends on Enter unless Shift held; phone keyboards have no Shift, so newlines are impossible. Detect pointer:coarse → Enter inserts newline, Send button submits. | S | `apps/frontend/src/components/Composer.tsx` |
| P0 | **Hide pair button on phone** — Sidebar.tsx:42 always renders the pair button + modal; pairing is a desktop→phone handoff, pure noise on the already-paired phone. Hide on coarse-pointer and when no tailscaleHost+token. | S | `apps/frontend/src/components/Sidebar.tsx` |
| P0 | **Split start vs pair banner (stop QR spam)** — index.ts:32 printAccessBanner always renders the full QR, burying the listening line. Compact 3-line start banner; keep full QR only in pnpm pair. | S | `apps/backend/src/index.ts, apps/backend/src/banner.ts, apps/backend/src/pair.ts` |
| P0 | **Codex session discovery from disk** — routes.ts:47 runs removed 'codex session list' subcommand; throws and leaks stderr on every probe. Walk ~/.codex/sessions/**/rollout-*.jsonl, parse line-1 session_meta, filter by cwd. | M | `apps/backend/src/routes.ts, apps/backend/test/routes.test.ts` |
| P0 | **Token-gate guidance copy** — TokenGate.tsx gives no hint where the token lives; owner on same box is stuck. Add copy pointing to TRUX_SECRET in ~/.trux/.env and the pair QR. Do NOT trust loopback (tailscale serve proxies to 127.0.0.1). | S | `apps/frontend/src/components/TokenGate.tsx` |
| P0 | **Bump sw.js cache version** — Phone must pull the new shell after Phase 0 ships; cache-first assets otherwise serve stale UI. | S | `apps/frontend/public/sw.js` |
| P1 | **Streaming caret** — Assistant text renders static with no liveness cue. Copper block caret at the tail of the latest text item while status==='thinking', fading on turn_complete. The difference between 'text appearing' and 'alive'. | S | `apps/frontend/src/components/Transcript.tsx, apps/frontend/src/index.css` |
| P1 | **Sticky-but-polite autoscroll** — Transcript has no scroll ref at all; the view neither follows the stream nor lets you read history. Scroll to bottom only when already within ~80px; never yank a reader. | M | `apps/frontend/src/components/Transcript.tsx, apps/frontend/src/components/ConversationView.tsx (new useStickyScroll hook)` |
| P1 | **Scroll-to-latest FAB with new-activity badge** — Once autoscroll is polite, a user scrolled up needs a one-tap way back to live and a signal something arrived. Gate visibility through a ref to avoid 60Hz re-renders. | S | `apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/index.css` |
| P1 | **One-tap code-block copy + language label** — Markdown.tsx is bare ReactMarkdown; manual multi-line selection on a phone is the worst friction in a coding tool. Custom code/pre renderer with copy button + copper flash + haptic. Keep no-raw-HTML default. | S | `apps/frontend/src/components/Markdown.tsx, apps/frontend/src/index.css` |
| P1 | **Tool-call ActivityGroup clustering** — Transcript.tsx renders each tool_call/result as its own <details> — a wall of boxes that buries the answer. Fold consecutive calls into one collapsible cluster with elapsed timer; auto-collapse on turn_complete, never reopen a user-closed group. | M | `apps/frontend/src/components/Transcript.tsx, apps/frontend/src/store.ts, apps/frontend/src/tools.ts, apps/frontend/src/index.css` |
| P1 | **Haptic feedback layer** — No haptics anywhere; the glance-at-my-phone scenario needs physical confirmation. navigator.vibrate ticks on send/copy, medium on interrupt/stop, notification pattern on approval/turn-complete. Degrade gracefully. | S | `apps/frontend/src/components/Composer.tsx, apps/frontend/src/components/Markdown.tsx, apps/frontend/src/components/ConversationView.tsx (new haptics util)` |
| P1 | **prefers-reduced-motion gating** — rise/pulse/caret animations honor no reduced-motion preference today — accessibility + motion-sickness gap. | S | `apps/frontend/src/index.css` |
| P1 | **Resilient WebSocket: reconnect + epoch guard + connection state** — truxClient.ts opens the socket once, no close/error handler; first phone sleep silently kills the conversation. Capped backoff + connection epoch (kills stale-socket races) + connected/reconnecting/offline in the store. | M | `apps/frontend/src/truxClient.ts, apps/frontend/src/store.ts, apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/index.css` |
| P1 | **Optimistic send + sending/failed/retry states** — User message only appears on the server echo (manager.ts:83); over a dead socket it vanishes with no feedback. Render the bubble instantly, reconcile on echo, mark failed with retry. | M | `apps/frontend/src/store.ts, apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/components/Transcript.tsx` |
| P1 | **Seq-on-wire** — registry.ts:115 allocates per-conversation seq but it never reaches the client. Thread seq through manager.emit/stampTurn (text_delta stays unsequenced) so the client can request deltas. | M | `apps/backend/src/manager.ts, packages/protocol/src/events.ts, apps/backend/src/stream.ts` |
| P1 | **resume{since_seq} → history_delta / history_snapshot** — stream.ts restores history only via full REST refetch — slow and janky on a flaky link. Add a resume message returning only missed events, snapshot fallback when the gap is too large. | M | `apps/backend/src/stream.ts, apps/backend/src/manager.ts, apps/backend/src/registry.ts, packages/protocol/src/events.ts, apps/frontend/src/truxClient.ts, apps/frontend/src/store.ts` |
| P1 | **client_message_id + input_ack + offline queue** — Closes the sent-vs-received ambiguity a flaky link creates. Queue outbound prompts/approvals to localStorage when down, dedupe by id, auto-flush on reconnect, idempotent server handling. | L | `packages/protocol/src/events.ts, apps/backend/src/manager.ts, apps/backend/src/stream.ts, apps/frontend/src/truxClient.ts, apps/frontend/src/store.ts` |
| P1 | **Server-side web-push notifications** — The reason to own a phone client: pocket it, get pulled back when the agent needs you. Push must originate from the manager (PWA is closed). web-push/VAPID + /push/subscribe + sw.js push/notificationclick, deduped per request/turn id. | M | `apps/backend/src/manager.ts, apps/backend/src/routes.ts, apps/backend/src/db.ts, apps/frontend/public/sw.js, apps/frontend/src/main.tsx` |
| P1 | **Notification privacy mode + lifecycle gating** — Lockscreen previews leak code; foregrounded user shouldn't be spammed. Privacy toggle genericizes the body; suppress (haptic instead) when PWA is foregrounded on that conversation via visibilityState. | S | `apps/backend/src/manager.ts, apps/frontend/src/store.ts, apps/frontend/public/sw.js` |
| P1 | **Pinned approval banner** — ApprovalCard scrolls away with the transcript, stranding a blocked agent unseen. Pin the latest unresolved approval above the composer while awaiting_approval; haptic + entrance on arrival. | M | `apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/components/ApprovalCard.tsx, apps/frontend/src/index.css` |
| P1 | **Structured approval presentation (not JSON)** — ApprovalCard dumps JSON.stringify(input). Parse into title + the one command/file (copper mono) + expandable raw with light syntax tint. Reuse tools.ts summaries. | M | `apps/frontend/src/components/ApprovalCard.tsx, apps/frontend/src/tools.ts` |
| P1 | **Graduated approval scopes + optimistic per-button state** — Flat allow/deny/always forces babysit-everything or full-yolo. Add allow_edits / allow_command scopes (+Bash command pinning, mode-flip), per-button spinners, dimmed decision history. | L | `packages/protocol/src/events.ts, apps/backend/src/manager.ts, apps/backend/src/adapter/claude.ts, apps/frontend/src/components/ApprovalCard.tsx` |
| P1 | **Edit/Write diff cards + full-width DiffView** — Every tool_result is a <pre> dump; can't review changes before approving. Compact diff preview inline routing to a dedicated full-width DiffView (modal mobile / side panel desktop). | L | `apps/frontend/src/components/Transcript.tsx, apps/frontend/src/components/DiffView.tsx (new), apps/frontend/src/index.css` |
| P1 | **Git route + GitPanel (safe ops + AI commit message)** — Closing the review-and-commit loop is Trux's edge over a terminal. /conversations/:id/git runs status/diff/staged; GitPanel stages and commits. Safe ops only — no reset/push/rebase/checkout from the phone. | L | `apps/backend/src/routes.ts, apps/backend/src/manager.ts, apps/frontend/src/components/GitPanel.tsx (new), apps/frontend/src/api.ts` |
| P1 | **Git status badge in conversation bar** — Live dirty/ahead/behind state from the same porcelain call gives glanceable repo state during a turn. | S | `apps/frontend/src/components/ConversationView.tsx, apps/backend/src/routes.ts` |
| P1 | **Store-level multiplexed connection manager** — ConversationView mounts one WS per id and tears it down on switch — only one conversation is ever live, so background work awareness is lost. Lift the socket to the store. | L | `apps/frontend/src/store.ts, apps/frontend/src/truxClient.ts, apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/App.tsx` |
| P1 | **Unread + needs-you roster in sidebar** — Driving several agents and seeing which is blocked on you is the defining capability. Add solid-copper unread + pulsing awaiting_approval states to existing dot classes. | M | `apps/frontend/src/components/Sidebar.tsx, apps/frontend/src/store.ts, apps/frontend/src/index.css` |
| P1 | **Bottom-anchored mobile conversation quick-switcher** — Sidebar collapses to 38vh at the top, out of thumb reach. Add a bottom-anchored switcher/bottom-sheet showing status dots so one-handed switching works. | M | `apps/frontend/src/components/Sidebar.tsx (or new QuickSwitcher.tsx), apps/frontend/src/index.css` |
| P1 | **Per-conversation drafts (text + attachments)** — Mobile users get interrupted constantly; losing a half-typed prompt on switch or app-kill destroys trust. Persist per id to localStorage with temp-id→real-id migration; pencil badge in sidebar. | M | `apps/frontend/src/components/Composer.tsx, apps/frontend/src/store.ts, apps/frontend/src/components/Sidebar.tsx` |
| P2 | **Run status with elapsed time + current tool + rotating verb** — STATUS_LABEL is terse; long waits are opaque. Add 'Thinking… 0:14'/'Running pytest' and a rotating verb that doubles as a liveness indicator (frozen verb = hung stream). | M | `apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/store.ts, apps/frontend/src/index.css` |
| P2 | **Token usage + cost display** — TurnCompleteEvent already carries usage + cost but nothing renders it. Per-turn cost badge + sidebar usage roll-up. No backend change. | S | `apps/frontend/src/components/Transcript.tsx, apps/frontend/src/components/Sidebar.tsx, apps/frontend/src/store.ts` |
| P2 | **Conversation search in sidebar** — FTS5 /conversations/search endpoint exists but no UI. Add a search input that calls it. | S | `apps/frontend/src/components/Sidebar.tsx, apps/frontend/src/api.ts` |
| P2 | **Workspace picker grouping/search/recency** — NewConversationDialog.tsx:59 flattens every worktree into one <select>. Group with <optgroup> per root, sort MRU, default last-used; ideally searchable typeahead. | M | `apps/frontend/src/components/NewConversationDialog.tsx, apps/backend/src/workspaces.ts` |
| P2 | **Conversation list previews + timestamps + sort/filter** — List shows only title/agent/branch; can't see last message, recency, or unread count. Add preview snippet, last-active time, sort/filter. | M | `apps/frontend/src/components/Sidebar.tsx, apps/backend/src/registry.ts` |
| P2 | **Long-press message context actions** — Messages are static text. Long-press → bottom sheet: Copy (minimal), then Retry (assistant) / Edit & resend (user). 400ms long-press. | M | `apps/frontend/src/components/Transcript.tsx, apps/frontend/src/index.css` |
| P2 | **Attachment MIME from magic bytes + tappable lightbox** — Mobile pickers re-encode to JPEG keeping a .png name; Claude API rejects the mismatch. Detect MIME from magic bytes. Make tool-result images tappable instead of fixed 70vh. | S | `apps/frontend/src/components/Composer.tsx, apps/frontend/src/components/Transcript.tsx` |
| P2 | **Voice input into composer** — Dictation is often the fastest way to compose a long prompt on a phone. Mic button → Web Speech API, insert at cursor. | M | `apps/frontend/src/components/Composer.tsx` |
| P2 | **Pull-to-refresh resync + SW cache bust** — Team already pull-to-refreshes manually to bust the SW cache. Make it a real gesture that resyncs the transcript. | S | `apps/frontend/src/App.tsx, apps/frontend/public/sw.js` |
| P2 | **Motion tokens + panel depth** — Promote ad-hoc transitions to --ease/--dur tokens; add 1px top-highlight borders on stacked panels so they read as physically layered. Connective craft tissue. | S | `apps/frontend/src/index.css` |
| P2 | **ARIA + safe-area-inset-top on conversation bar** — Status dot/tool names/connection state lack ARIA labels; status line sits under the notch in standalone PWA mode. | S | `apps/frontend/src/index.css, apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/components/Sidebar.tsx` |
| P2 | **visualViewport keyboard avoidance** — 100dvh alone doesn't guarantee the latest message / pinned approval stay above the soft keyboard. Use the visualViewport API. | M | `apps/frontend/src/components/ConversationView.tsx, apps/frontend/src/index.css` |
