# Phase 8 — Depth & polish (plan)

Spec: `docs/superpowers/specs/2026-06-17-trux-v2-design.md` §7 P2 items.

**Goal:** Elevate the day-to-day experience: visibility into cost/time, faster navigation, voice input, gesture polish, and accessibility gaps.

## Tasks (TDD, per-task commit)

1. **Run status + elapsed timer** — `ConversationView`: show `Thinking… 0:14` while `status === 'thinking'`; count from first `turn_started` event (or first render of thinking state); stop on `turn_complete`/`status`≠thinking. CSS: replace `.status.thinking` text with the timer value. Test: timer increments.
2. **Token/cost display** — `TurnCompleteEvent` carries `cost` (number). Accumulate per-conversation in `convMeta.totalCost` (via `setConvMeta`). Show per-turn cost badge in transcript (`turn_complete` is not rendered today — add a small grey badge after the last tool group). Show sidebar roll-up. Test: cost accumulates.
3. **Conversation search in sidebar** — debounced text input calls `api.searchConversations(q)`; results replace the conversation list while focused. Escape clears. Test: input appears, calls search.
4. **Workspace picker grouping** — `NewConversationDialog`: group `<optgroup>` by workspace root; sort MRU (last `conversation.updated_at`); default to last-used workspace. Test: groups render.
5. **Conversation list previews + timestamps** — Sidebar list items: last assistant text snippet (first 60 chars from registry `lastMessage`) and relative timestamp. Backend: add `last_message` + `last_active_at` to `GET /conversations` response. Test: snippet appears.
6. **Voice input** — Mic button in Composer → Web Speech API `SpeechRecognition`; transcript inserted at cursor; falls back gracefully when API unavailable. Test: mic button present; no-op when unavailable.
7. **ARIA + safe-area-inset-top** — `aria-label` on status dot, conn-state, conversation bar; `padding-top: env(safe-area-inset-top)` on conversation bar. Reduced-motion already gated. Test: aria labels on key elements.

## Notes
- Tasks 1–3 are the highest impact; 4–7 are polish
- Token cost display requires no backend change (cost already on TurnCompleteEvent)
- Voice input degrades gracefully: hide mic button if `SpeechRecognition` unavailable
- Conversation list previews (task 5) requires backend DB change — add columns or derive from transcript query
