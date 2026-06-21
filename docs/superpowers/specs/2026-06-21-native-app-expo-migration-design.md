# Native App via Expo — Frontend Migration Design Spec

**Status:** design, pending implementation plan
**Date:** 2026-06-21
**Revised:** 2026-06-21 after a design review (verified against the codebase). The earlier framing — "Expo *is* the web build, retire the Vite PWA at cutover" — was **dropped**: Expo owns **native**, the Vite PWA **remains the web surface unchanged**, and the two share only a logic spine. Rationale in Governing principle #1.
**Scope:** Build a new **Expo (React Native) native app** for iOS/Android, borrowing UI from `slopus/happy` (MIT), sharing trux's logic spine with the existing Vite PWA via a new `packages/client`. trux's backend, `@trux/protocol`, token auth, and direct-connection transport are untouched. Realizes the roadmap item *"Native mobile app + push notifications"* ([roadmap](../../2026-06-16-trux-roadmap.md) line 117). Converging web onto Expo is an explicit **later, optional** step (Phase E), not a commitment of this migration.

---

## Governing principle: one spine, two view-layers — borrow views, not the platform

Two ideas drive every decision below.

**1. Share the *spine*, not the *views*. The Vite PWA stays the web surface; Expo owns native.** It is tempting to make one Expo codebase serve web *and* native via `react-native-web` and retire the PWA. The review killed that: (a) happy's reusable UI is React Native — it does **nothing** for a react-dom web page, so the reuse payoff is **native-only**; (b) trux's web differentiator *today* is server-side **web-push through a service worker** (`push.ts`, `apps/frontend/public/sw.js`) plus installability — and Expo web hands you **none** of that for free, so forcing Expo to be the web build spends real risk re-hardening the headline feature for zero near-term gain. So instead we **extract the logic spine into `packages/client`** and consume it from **both** the unchanged Vite PWA (web) and the new Expo app (native). "One codebase for web too" becomes a *later optional convergence* (Phase E), gated on Expo web matching the PWA's SW/web-push/install story — never a forced cutover.

**2. happy donates *views*, trux keeps its *spine*.** The expensive, already-solved part of an agent chat UI is the per-tool rendering — happy ships a tool-render registry and ~18 per-tool cards (Bash/Edit/MultiEdit/Write/Todo/Task/MCP/AskUserQuestion across Claude, Codex, Gemini). We lift those into the native app. We do **not** lift happy's platform: its relay server, E2E `sync`/`encryption`, and its ~100-dep surface (LiveKit, WebRTC, Skia, libsodium, RevenueCat, PostHog, Tauri, vision-camera, ElevenLabs voice). trux's spine — `@trux/protocol`, the WebSocket client, the zustand store, token auth, direct connection over *your* tailnet — stays exactly as it is.

**The blade.** We take UI components, never transport. Nothing alters the backend, `packages/protocol` semantics, the auth/token model, or trux's no-relay sovereignty. happy's transport contradicts trux; it is out by definition. The same blade that keeps trux from being a model-manager keeps it from inheriting someone else's platform.

> **Sovereignty bonus.** Going native unlocks the roadmap's **embedded `tsnet`** option — the app *is* its own tailnet node, so there's no separate Tailscale install and still no server in the path. That directly retires the "tailnet must be up" footgun from the 2026-06-19 phone test. `tsnet` is **out of scope here** (a later transport phase) but the native app is its precondition.

---

## Architecture overview

```
 trux backend  (unchanged, direct WS + REST)
        ▲                         ▲
        │ binds browser ports     │ binds native ports
        │ (localStorage, relative │ (secure-store, paired host)
        │  fetch, location wss)    │
 ┌──────┴───────────┐      ┌──────┴───────────────────────────────┐
 │  Vite PWA (web)  │      │  Expo app  (apps/mobile · native)     │
 │  react-dom       │      │  React Native · Expo Router           │
 │  UNCHANGED:      │      │  trux components (re-skinned div→View) │
 │  SW + web-push   │      │   + happy tool-views via toolView      │
 │  + installable   │      │     adapter  + diff + markdown         │
 └──────┬───────────┘      └──────┬───────────────────────────────┘
        │                         │
        └──────────┬──────────────┘
                   ▼
        packages/client   (NEW · platform-agnostic spine)
        truxClient · connectionManager · outbox · store · api · tools · diff
        ports:  Storage   ServerConfig(httpBase, wsBase)
                   │
                   ▼
        @trux/protocol   (unchanged)
```

**Three layers, by treatment:**

| Layer | trux source today | Treatment |
|---|---|---|
| **Spine** — transport, state, protocol | `truxClient.ts`, `connectionManager.ts`, `outbox.ts`, `store.ts`, `api.ts`, `tools.ts`, `diff.ts` | **Extract to `packages/client`, made platform-agnostic via injected ports.** Transport core is already portable (verified); the work is decoupling browser globals (see Phase A). Consumed by *both* apps. |
| **Platform glue** — per-app | `pairing.ts` (token *acquisition*), `push.ts`, `haptics.ts`, shell | **Stays per app.** Web keeps URL-fragment pairing + web-push SW; native gets QR-camera pairing + `expo-notifications` + `expo-haptics`. |
| **Views** — components (native only) | `ConversationView`, `Composer`, `Transcript`, `ApprovalCard`, `ActivityGroup`, `CommandPalette`, `DiffView`, `GitPanel`, `Markdown`, `Rail`, `TokenGate`, `PairModal`, `NewConversationDialog`, `ControlPicker`, `ConversationList`, `Icon` (16) | **Reuse-heavy rewrite** for RN (`div`→`View`, CSS→styles), **folding in happy's richer versions** (tool-views, diff, markdown). The PWA's web components are untouched. |

**The central integration seam** is the `toolView` adapter: happy's views are typed against happy's own model (`knownTools.tsx` imports `ToolCall`/`Message` from `@/sync/typesMessage` and parses with `zod`); trux speaks `packages/protocol` events. We keep happy's **rendering** and feed it trux's **data** — a mapper from trux tool-call/result events to the shape `knownTools` dispatches on. Keeping the registry intact (vs. rewriting each card) keeps upstream happy improvements mergeable.

---

# Phase A — Native-first foundation: shared spine + host-configured connection

The shippable first cut, **on a native dev build** (not a web rerender). It proves the genuinely-new native realities the PWA never had to face — **no implicit origin, no `localStorage`, no URL-fragment pairing** — end to end: pair to a host, store a token securely, connect, list conversations, open one, send a turn, render streamed assistant text.

## A1. Extract the spine to `packages/client` (platform-agnostic)
New workspace package consumed by **both** apps: `truxClient`, `connectionManager`, `outbox`, `store` (zustand), `api`, `tools`, `diff`. Decouple from browser globals via two injected **ports**:
- **`Storage`** (`get/set/remove`) — web binds `localStorage`; native binds `expo-secure-store`/MMKV. Replaces every `localStorage` read (`connectionManager.ts:34`, `api.ts` `authHeaders`, the token gate, the outbox).
- **`ServerConfig`** (`httpBase`, `wsBase`) — web binds `httpBase: ''` (preserves today's relative `fetch('/…')`) and derives `wsBase` from `location` (`connectionManager.ts:35‑37`); native binds **both** from the paired host. This makes *"which server am I talking to"* first-class state — exactly what native cannot get for free, and the seam ccpocket-style multi-host rides on later.

The transport core itself is already portable — `truxClient.ts:46` opens `new WS(url)` with **in-band token auth** (`truxClient.ts:51`) over **text-JSON frames** (`truxClient.ts:62`), so there are no RN header/binary workarounds. **Prove the ports by refactoring the Vite PWA onto `packages/client` first, behavior unchanged** — the existing suite staying green is the evidence, before any RN code exists.

## A2. Scaffold the Expo native app (`apps/mobile`)
Expo Router app consuming `packages/client` + `@trux/protocol`. Theme foundation (copper + IBM Plex via `expo-font`), `(app)` navigation shell (conversation list → `session/[id]`). Native port bindings: `expo-secure-store` Storage, paired-host ServerConfig.

## A3. Host configuration + QR-camera pairing (the native-only reality)
Web reads the token from the URL fragment (`pairing.ts`, `#token=`); **native has no URL** — it **scans the `trux pair` QR with the camera** (`expo-camera`), parses the encoded `https://<host>.ts.net/#token=…`, and persists host + token to secure store. Net-new and the riskiest native surface, so it lands in A, not "later."

## A4. End-to-end skeleton (native)
Host/token gate → `ConversationList` → minimal `ConversationView` + `Composer` → plain-text `Transcript`, carrying the reconnect/connection-state indicator from `connectionManager`. Rich tool-cards and native push come later.

## A5. Phase A testing
- **packages/client:** the existing spine logic tests move with it and stay green under fake `Storage`/`ServerConfig` ports.
- **PWA regression (the proof):** the refactored Vite PWA passes its full existing suite unchanged — evidence the extraction was behavior-preserving.
- **native skeleton:** gate blocks without host+token; QR parse yields host+token; list renders; send routes through a faked client; streamed text appends.

---

# Phase B — Conversation surface + graft happy's tool-views (native)

Where "happy's richer UX as we go" lands.

## B1. The `toolView` adapter (the seam)
Map `packages/protocol` tool-call/result events → the view-model `knownTools.tsx` dispatches on (the shape its `zod` schemas parse). One mapper, one place; every per-tool card downstream is then data-driven. Unknown tools fall back gracefully.

## B2. Graft happy's tool rendering — vendor the *substrate*, not just the cards
The views are woven into happy's internals, so vendoring is wider than the per-tool files: `knownTools.tsx` pulls `@/sync/typesMessage` (data model), `@/text` (i18n `t(…)` in every view), `@/utils/*`, and `zod`; `BashView.tsx` pulls sibling components `CommandView` + `ToolSectionView` (which pull theme/`unistyles`/`Typography`). So the unit of work is **vendor-or-replace happy's substrate**: tool registry + chrome (`ToolHeader`, `ToolView`, `ToolDiffView`, `ToolStatusIndicator`, `ToolError`, `PermissionFooter`) + `views/*` (incl. Codex variants — trux drives codex) + the `CommandView`/`ToolSectionView` atoms + an i18n shim + the data types. **Cherry-pick only the npm deps these truly need** (`react-native-svg`, `@expo/vector-icons`, `reanimated`, `gesture-handler`, `react-native-diff-view`, a styling lib) — none of happy's platform deps. Re-skin to trux's theme tokens (or adopt unistyles + vendor happy's theme — see Open items).

## B3. Re-skin trux's own conversation components (native)
`Composer` (auto-grow, send/interrupt, keyboard handling via `react-native-keyboard-controller`), `ApprovalCard` + `PermissionFooter` wired to trux approval events, `ActivityGroup`, `Markdown` (replace `react-markdown` — DOM-only — with an RN markdown renderer), `DiffView` (folded into happy's `ToolDiffView`).

## B4. Phase B testing
- **adapter:** fixture trux tool events map to the right view-model; unknown tools fall back.
- **views:** each per-tool card renders its fixture; approval card emits the approve/deny event trux expects; diff renders add/remove.
- **parity:** native transcript matches the PWA on the same conversation fixture; mobile-viewport screenshots (per the project's mobile-UX standard).

---

# Phase C — Remaining native surfaces + native push (feature parity, no cutover)

Bring the native app to feature parity with the PWA. The PWA keeps serving web throughout.

## C1. Remaining surfaces
`CommandPalette` (re-skin trux's Phase-A palette; optionally adopt happy's `autocomplete` for `/` and `@file`), `GitPanel` + session `files`/`file` browser (happy's `session/[id]/files`), `PairModal`/host management, `ControlPicker`, settings.

## C2. Native push (rebuild the SW behaviours natively)
Register via `expo-notifications` through the **same** `/push/subscribe` route + manager emit path (backend unchanged). The PWA's service worker also does two things that must be rebuilt natively, not just "registered": **deep-link on tap** → `expo-notifications` response listener + `expo-linking` to the conversation; and **suppress when foregrounded on that conversation** → app-state/route check (mirrors `sw.js`'s `c=` focus check). Privacy-mode genericized body carried over.

## C3. Phase C testing
Native feature-parity pass (every PWA affordance present on native), push round-trip + deep-link + suppression on a device, mobile screenshots, clean typecheck, green suite.

---

# Phase D — Ship native via EAS (the destination)

EAS profiles for iOS/Android, TestFlight/Play internal track, store metadata — same source. Embedded `tsnet` transport (roadmap line 117) is its own subsequent phase. Listed to fix the destination; execution is a follow-on, gated on C parity.

---

# Phase E — Converge web onto Expo (optional, later — not committed here)

*Only if* it earns its keep: collapse the Vite PWA onto the Expo `react-native-web` web build so web and native share one view-layer too. **Gated on Expo web matching the PWA's current web story** — a registered service worker, server-side **web-push**, and installability/manifest. Until that parity is demonstrated, **the Vite PWA remains the web surface** and this phase does not happen. This is the only place the original "one codebase for web too" idea survives — as an option, not a cutover.

---

## Platform / mobile-UX requirements (native, cross-cutting)

trux is mobile-first; the native app must *improve* on the PWA's ergonomics:
- **Keyboard avoidance** via `react-native-keyboard-controller`, sticky thumb-reachable composer, safe-area insets top *and* bottom.
- **Large tap targets** (≥44px), haptics on send/approve/turn-complete (`expo-haptics`).
- **Native gestures** (`gesture-handler`/`reanimated`) for the conversation drawer and bottom sheets — the command palette stays a bottom sheet, not a desktop dropdown.
Verify every phase with mobile-viewport screenshots, per the project standard.

---

## Non-goals

- **No transport change.** No relay, no E2E sync, no happy-server. Backend, `@trux/protocol`, token auth, and direct-WS sovereignty are untouched. `tsnet` is a *later* phase.
- **No inheriting happy's platform.** Vendor components/substrate, not the app: no LiveKit/WebRTC/Skia/libsodium/RevenueCat/PostHog/Tauri/vision-camera. **Voice is explicitly out** of this migration.
- **No web regression and no forced cutover.** The Vite PWA's web-push/SW/install story is untouched; `apps/frontend` is **not** retired here. Expo is not made the web build in this migration — convergence is the optional Phase E.
- **No redesign.** Parity first on native; happy's tool-views are a *fidelity upgrade*, not a reinvention of trux's identity.
- **No backend coupling.** The `toolView` adapter is the only new seam, and it reads existing protocol events.

---

## Open items resolved at plan time (not design unknowns)

- **MIT attribution.** happy is MIT — vendored files (including substrate: `@/text`, `@/sync` types, utils, `CommandView`/`ToolSectionView`) must retain copyright/notice; add a `THIRD-PARTY` notice and pin the source happy commit. Decide copy-with-attribution vs `git subtree`.
- **happy substrate boundary.** How much to vendor vs replace: adopt `react-native-unistyles` + vendor happy's theme (smoother graft) vs re-skin every view to trux tokens (more uniform, more work); and whether to vendor `@/text` i18n or stub `t()` to literals.
- **Test runner.** Spine logic stays on vitest (portable, via the ports); RN components use `jest-expo` + `@testing-library/react-native`. Confirm the split vs unifying.
- **Markdown.** RN replacement for `react-markdown`/`remark-gfm` (`react-native-markdown-display` vs happy's renderer); confirm GFM + code-block fidelity.
- **Exact happy paths/version** to vendor (`packages/happy-app/sources/components/tools/**`, `sources/components/{diff,markdown,autocomplete}`, `sources/app/(app)/session/**`) and the precise view-model the adapter targets.
- **Phase E feasibility (deferred).** What Expo web actually needs to match the PWA (SW registration, web-push, manifest/install) — assessed only if/when Phase E is taken up; not on this migration's critical path.
