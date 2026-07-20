# Mobile UI shell polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix home chrome overload, send-button contrast, provider Connect bugs, and project path picking via a host directory browser.

**Architecture:** Mobile UI changes in Expo app; provider state fix is client-only; directory browser adds a scoped Fastify route + client API + new-project browse mode. Tokens stay dark-sumi/celadon.

**Tech Stack:** Expo Router, React Native, Fastify, Vitest, Jest

**Spec:** `docs/superpowers/specs/2026-07-20-mobile-ui-shell-polish-design.md`

---

### Task 1: Home header overflow (A)

**Files:**
- Modify: `apps/mobile/app/(app)/index.tsx`
- Modify: `apps/mobile/src/components/desktop/Sidebar.tsx` (footer links if header-duplicated)
- Modify: `apps/mobile/app/(app)/index.test.tsx`
- Create (optional): `apps/mobile/src/components/OverflowMenu.tsx`

- [ ] **Step 1:** Replace key + settings icon buttons with one overflow control that presents labeled actions (Providers, Settings) via `ActionSheetIOS` / simple modal sheet on Android/web.
- [ ] **Step 2:** Keep New project as the only primary header action.
- [ ] **Step 3:** Update index tests for overflow + new project.
- [ ] **Step 4:** Align desktop Sidebar footer: Providers / Settings text links; remove redundant icon cluster if present.

### Task 2: Send button contrast (B)

**Files:**
- Modify: `apps/mobile/src/components/Composer.tsx`
- Modify: any Composer snapshot/unit tests if present

- [ ] **Step 1:** Composer shell `backgroundColor: theme.surface1`.
- [ ] **Step 2:** Enabled send: `accentBright` (or accent + border `accent`); disabled: transparent/`surface1` + `borderColor: theme.line` + dim mark (`textDim`).
- [ ] **Step 3:** Visual/unit sanity — disabled style distinct from enabled.

### Task 3: Provider Connect harden (C)

**Files:**
- Modify: `apps/mobile/app/(app)/providers.tsx`
- Test: extend providers test if exists, else add focused unit/helpers

- [ ] **Step 1:** Change device state to `{ providerId, verifyUrl, userCode, needsCode } | null`.
- [ ] **Step 2:** On Connect for provider P, set providerId=P; clear device when starting another provider or on disconnect success.
- [ ] **Step 3:** Remove `onFocus={() => setActive(id)}` side effect that steals active without clearing device (or clear device when active changes without a matching providerId).
- [ ] **Step 4:** Add **Open browser** (`Linking.openURL` with try/catch) + **Copy link** (`expo-clipboard`); auto-open once after begin; show error text on failure.
- [ ] **Step 5:** Show device panel only when `device?.providerId === id`.

### Task 4: Directory browse API (D backend)

**Files:**
- Create: `apps/backend/src/fs-browse.ts`
- Modify: `apps/backend/src/routes.ts` (or `server.ts` bearer scope)
- Create: `apps/backend/test/fs-browse.test.ts`
- Modify: `packages/protocol` REST types if shared; else inline in client

- [ ] **Step 1:** Implement `allowedRoots(config): string[]` = unique resolved `$HOME` + `workspaceRoots`.
- [ ] **Step 2:** `listDirs(path, roots)` — resolve realpath; reject if outside roots; return `{ path, parent, entries: { name, path }[] }` directories only; sort by name.
- [ ] **Step 3:** `GET /fs/dirs?path=` behind bearer; default path = first root / home.
- [ ] **Step 4:** Vitest: inside root ok; path traversal `../` rejected; file path rejected or empty.

### Task 5: Client API + new-project browser (D frontend)

**Files:**
- Modify: `packages/client/src/api.ts`
- Modify: `apps/mobile/app/(app)/new-project.tsx`
- Test: `apps/mobile` new-project tests if any; client api test optional

- [ ] **Step 1:** `api.listDirs(path?: string)`.
- [ ] **Step 2:** New-project default mode = browser: breadcrumb (tap ancestors), folder rows, **Use this folder** sets cwd + name basename.
- [ ] **Step 3:** Keep search/recents and manual paste as secondary toggles.
- [ ] **Step 4:** Smoke: create still POSTs project with chosen cwd.

### Task 6: Verification

- [ ] `pnpm --filter @trux/backend test` (or fs-browse + routes subset) + typecheck
- [ ] `pnpm --filter @trux/mobile test` for touched screens
- [ ] Manual checklist: header ⋯, send contrast, Connect open/copy, browse from home
