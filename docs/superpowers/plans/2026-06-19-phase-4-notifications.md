# Phase 4 — Web-push notifications (plan)

Spec: `docs/superpowers/specs/2026-06-17-trux-v2-design.md` §5 P1 #9 + #11, phase list "Phase 4".

**Goal:** Pocket the phone, get tapped on the shoulder when the agent needs you (approval) or finishes (turn_complete); tap through to the right conversation. Push originates **server-side** (PWA is closed most of the time). Privacy mode genericizes the body; foregrounded-on-that-conversation is suppressed (haptic instead).

## Architecture

- **VAPID keys**: generated once via `web-push`, stored in `~/.trux/vapid.json` (or `TRUX_VAPID_*` env). Public key exposed via `/config` so the client can subscribe. If keys can't be established, push is silently disabled (feature-detect on client).
- **Subscriptions**: a `push_subscriptions` SQLite table (endpoint PRIMARY KEY, p256dh, auth, conversation-agnostic — a device gets all this owner's pushes). Stored via `POST /push/subscribe`, removed via `POST /push/unsubscribe` or on 404/410 from the push service.
- **Emission**: a `Notifier` seam owned by the manager. On `approval_request` and `turn_complete` the manager calls `notifier.notify({conversationId, kind, title, body})`. Deduped per `request_id` (approval) / `turn_id` (turn_complete) so a reconnect replay or double-emit can't double-notify. Privacy mode (config/env `TRUX_PUSH_PRIVACY`) replaces body with generic text.
- **Client lifecycle gating**: the manager can't know if the PWA is foregrounded, so gating is client-cooperative: the client tells the server its currently-foreground conversation via a `presence` WS message (or the SW checks `clients` on push and suppresses if focused on that conversation). Simplest correct approach: **gate in `sw.js`** — on push, if a visible client is already focused on that conversationId, skip the notification (the open tab already has haptics). This keeps the server dumb and avoids presence races.
- **sw.js**: add `push` (show notification, or suppress if focused) and `notificationclick` (focus existing client + postMessage deep-link, or `openWindow` to `/?c=<id>`).
- **main.tsx / store**: register push subscription after SW ready + token present; a settings toggle for privacy mode is deferred (server-side env is enough for v1) — client just subscribes. Deep-link: App reads `?c=` / postMessage and selects the conversation.

## Tasks (TDD, per-task commit)

1. **`web-push` dep + VAPID key management** (`apps/backend/src/push.ts` new, `config.ts`). `loadOrCreateVapid()` returns keys from env or a json file, generating+persisting if absent. Test: generates valid-shaped keys, round-trips from disk, honors env. Wire publicKey into `/config`.
2. **`push_subscriptions` table + registry methods** (`db.ts`, `registry.ts`). `addPushSubscription`, `listPushSubscriptions`, `removePushSubscription`. Test in `registry.test.ts`: insert/list/dedup-by-endpoint/remove.
3. **`/push/subscribe` + `/push/unsubscribe` routes** (`routes.ts`). Validate body shape, store. Test in `routes.test.ts`.
4. **`Notifier` + manager emission** (`push.ts` `WebPushNotifier`, `manager.ts`). Manager takes an optional `Notifier`; emits on approval_request + turn_complete, deduped per request_id/turn_id. Inject a fake Notifier in `manager.test.ts`; assert one notify per approval/turn, deduped on replay, body generic under privacy. Prune subscription on 404/410.
5. **sw.js push + notificationclick + focus-suppression** (`public/sw.js`, bump SHELL). No unit test (SW), exercised manually; keep logic minimal + guarded.
6. **Client subscribe + deep-link** (`main.tsx`, `store.ts`, `App.tsx`, `api.ts`). Subscribe after SW ready when token present; `?c=`/postMessage selects conversation. Test deep-link param parsing in store/App test.

## Out of scope (deferred)
- In-app privacy-mode toggle UI (server env `TRUX_PUSH_PRIVACY` covers it).
- Per-conversation subscription scoping (a device gets all owner pushes).
