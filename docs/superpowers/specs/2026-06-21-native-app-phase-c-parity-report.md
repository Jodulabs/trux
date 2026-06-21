# Native App (Expo) — Phase C parity report & Phase D deferrals

**Status:** Phase C complete (native feature parity reached, modulo device-only verification)
**Date:** 2026-06-21
**Scope:** Closes Phase C of the [native-app-expo migration](./2026-06-21-native-app-expo-migration-design.md). Records the native↔PWA parity matrix and the items that can only be exercised on a physical device / EAS build, which move to Phase D.

---

## Parity matrix — every PWA affordance vs. native

| PWA affordance (`apps/frontend`) | Native status | Where |
|---|---|---|
| Token gate / authed shell | ✅ | `app/(app)/_layout.tsx` |
| QR-camera pairing + host management | ✅ | `app/pair.tsx`, `src/components/QrScanner.tsx` |
| Conversation list (search, cost badge, status/unread) | ✅ | `app/(app)/index.tsx` |
| New conversation (folder picker, agent, resume) | ✅ (C1) | `app/(app)/new.tsx` |
| Conversation view + connection banner | ✅ | `src/components/ConversationView.tsx` |
| Composer (send/interrupt) | ✅ | `src/components/Composer.tsx` |
| Control picker (model / opaque controls) | ✅ (C1) | `src/components/ControlPicker.tsx` |
| Transcript: user/assistant, tool grouping, approvals | ✅ | `src/components/Transcript.tsx` |
| Tool-view cards (Bash/Edit/Write/Todo/…) | ✅ (B2) | `src/tools/**` |
| Diff rendering (tool cards) | ✅ (B3) | `src/tools/DiffView.tsx` |
| Settings (host + token, re-pair) | ✅ (C1) | `app/(app)/settings.tsx` |
| **Git panel** (review / stage / diff / commit) | ✅ (C3) | `src/components/GitPanel.tsx` |
| **Command palette** (slash-command discover + run) | ✅ (C3) | `src/components/CommandPalette.tsx` |
| **Markdown** (assistant text, fenced code + copy) | ✅ (C3) | `src/components/Markdown.tsx` |
| Push notifications (register / deep-link / suppress) | ✅ code (C2) — device verify deferred | `src/notifications.ts` |
| `Rail` (desktop sidebar) | N/A — native uses stack navigation | — |

The native app is at functional parity with the PWA. The PWA remains the unchanged web surface (per the migration design's governing principle #1).

### C3 additions in detail

- **GitPanel** — full-screen `Modal`: branch + ahead/behind header, staged/unstaged file rows with a stage/unstage toggle, per-file unified-diff in a stacked `Modal`, and a commit-message + commit flow. Rides the existing safe-ops backend routes (`gitStatus`/`gitDiff`/`gitStage`/`gitUnstage`/`gitCommit`) — no reset/push/rebase. Entry point: a git badge in the session bar (shown only for repos), mirroring the PWA.
- **CommandPalette** — a **bottom sheet** (the mobile-UX standard, not a desktop dropdown): search, recents-first ordering (persisted via the shared `Storage` port), and an arg form for parameterized commands. Resolves the template (`resolveCommand`) and inserts it into the composer for review rather than auto-sending. Opened by a `/` button or by typing a lone `/`. Commands come from `api.discoverCommands(agent, cwd)`.
- **Markdown** — a lightweight RN renderer (no new markdown engine): fenced code blocks with one-tap copy (`expo-clipboard` + haptic — manual multi-line selection is the worst phone interaction), inline `` `code` ``, and `**bold**`. Replaces the plain assistant `<Text>` in the transcript. `parseBlocks` is exported and unit-tested as a pure function.

---

## Deferred to Phase D (device / EAS only)

These three are **not** code gaps — the code is written and unit-tested — but they cannot be *verified* without a physical device and an EAS build, which is itself Phase D.

1. **Push round-trip on a device.** `src/notifications.ts` registers an Expo push token, deep-links on tap, and suppresses the banner when foregrounded on the conversation; the backend (`apps/backend`) delivers to native tokens via the Expo Push Service (`ExpoPushNotifier`). End-to-end delivery requires:
   - an Expo account + EAS project → a `projectId` (today `Constants.expoConfig.extra.eas.projectId` is undefined in bare dev, so `getExpoPushTokenAsync` no-ops by design);
   - an EAS dev/prod build with push entitlements;
   - APNs key (iOS) and FCM credentials (Android) registered with Expo.
   Until then, registration degrades quietly to "no push" and the app is fully usable.

2. **Push deep-link + foreground-suppression on a device.** Logic is unit-tested with mocked `expo-notifications` (`src/notifications.test.ts`), but the real OS tap → route and the foreground/background banner decision can only be confirmed on hardware.

3. **Mobile-viewport screenshots.** The project's mobile-UX standard calls for screenshot verification each phase. A React Native app can't be screenshotted headlessly the way the PWA was (Playwright at 390px); it needs a simulator/emulator or device, available once EAS dev builds exist in Phase D.

### Phase D entry checklist (carried forward)

- [ ] Create EAS project; add `eas.json` build profiles (development / preview / production).
- [ ] Wire `projectId` into `app.json` `extra.eas.projectId`.
- [ ] Register APNs key + FCM credentials with Expo; verify the C2 push round-trip on a device.
- [ ] Capture mobile-viewport screenshots of every native surface.
- [ ] TestFlight / Play internal-track submission via EAS Submit.

---

## Verification at C3 close

- **Typecheck:** clean across all 5 workspace projects.
- **Tests:** 341 pass — protocol 24, client 41, backend 148, frontend 43, mobile 85. (Mobile gained 15 in C3: GitPanel 5, CommandPalette 4, Markdown 6.)
- **Web regression:** the Vite PWA's full suite stays green — the backend push change is additive and the shared `@trux/client` api is backward-compatible.
