# Phase E — Converge Web onto Expo (retire the PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference this plan is **lean** — implement directly, keep existing tests green and add a render gate, but skip the write-failing-test-first ceremony.

**Goal:** Make the Expo app (`apps/mobile`) the single source for all surfaces — its `react-native-web` build becomes the web surface served by the trux backend — and **delete the Vite PWA (`apps/frontend`)**, so every future feature is built once.

**Architecture:** Spike-proven: `expo export -p web` bundles cleanly once `react-native-web` + `@expo/metro-runtime` are added. The remaining work is runtime web fallbacks for native-only modules — all of which reduce to *what the old PWA already did*: a synchronous `localStorage` `Storage` port, a same-origin `ServerConfig`, and `#token=` URL-fragment pairing (camera QR is native-only). The backend then serves the Expo web export instead of `apps/frontend/dist`, and the PWA is removed.

**Tech Stack:** Expo SDK 56 + `react-native-web` + `@expo/metro-runtime`, Metro platform resolution (`*.web.ts(x)` files), the `@trux/client` spine ports, Fastify static serve, Playwright (render gate).

**Scope:** Retire the PWA / unify the lane. **Web-push + service worker are dropped on web** — the local **Android** native build already covers installable + push on mobile, so web demotes to a desktop/quick-access surface (a minimal SW can be rebuilt later if desktop notifications ever matter). Deferred features (native terminal pane, web preview, authenticator) come **after** this, on the unified lane.

**Branch / workspace:** a git **worktree** on `feat/phase-e-expo-web` (the user works in worktrees, not direct branches).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `apps/mobile/package.json` | modify | add `react-native-web`, `@expo/metro-runtime`; add a `build:web` script |
| `apps/mobile/app.json` | modify | `web: { bundler: "metro", output: "single" }` (SPA, matches the backend's index fallback) |
| `apps/mobile/src/ports.web.ts` | create | web port: sync `localStorage` Storage + same-origin `ServerConfig` + `#token=` capture (Metro picks `.web` for web) |
| `apps/mobile/app/pair.web.tsx` | create | web pairing fallback — manual token entry (no camera on web) |
| `apps/backend/src/server.ts` | modify | serve the Expo web export dir instead of `apps/frontend/dist` |
| `package.json` (root) | modify | `build` runs the Expo web export |
| `deploy/provision.sh` | modify | build the web export instead of `--filter frontend build` |
| `Dockerfile` | modify | build the web export in the image |
| `apps/frontend/**` | delete | the Vite PWA, retired |
| `pnpm-workspace.yaml` / refs | modify | drop `@trux/frontend` references left dangling by the deletion |

---

## Task 1: Add web deps + web config

- [ ] **Step 1:** In `apps/mobile`, install the SDK-pinned web deps:

```bash
pnpm --filter @trux/mobile exec expo install react-native-web @expo/metro-runtime
```
Expected: adds `react-native-web` (~0.21) + `@expo/metro-runtime` (~56) to `apps/mobile/package.json`.

- [ ] **Step 2:** In `apps/mobile/app.json`, add a `web` block under `expo` (SPA output so deep links fall through to one `index.html`, matching the backend's not-found handler):

```json
    "web": { "bundler": "metro", "output": "single" }
```

- [ ] **Step 3:** Add a `build:web` script to `apps/mobile/package.json` `"scripts"`:

```json
    "build:web": "expo export -p web --output-dir dist"
```

- [ ] **Step 4:** Verify the export still succeeds and writes an SPA:

```bash
pnpm --filter @trux/mobile build:web && test -f apps/mobile/dist/index.html && echo "web export OK"
```
Expected: `web export OK`.

- [ ] **Step 5:** Commit. (End messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.)

```bash
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml && git commit -m "build(mobile): enable Expo web (react-native-web + metro-runtime, SPA output)"
```

---

## Task 2: Web port (localStorage + same-origin)

Metro resolves `ports.web.ts` for the web bundle and the existing `ports.ts` for native — so this adds web without touching native. The web port deliberately mirrors the retired PWA's port model.

- [ ] **Step 1:** Create `apps/mobile/src/ports.web.ts`:

```ts
import { configureClient, type Storage, type ServerConfig } from '@trux/client/ports'

const HOST_KEY = 'trux_host'
const TOKEN_KEY = 'trux_token'

// Web surface = same model as the retired Vite PWA: synchronous localStorage and
// a same-origin ServerConfig (the web build is served by the trux backend itself).
const webStorage: Storage = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* quota */ } },
  remove: (k) => { try { localStorage.removeItem(k) } catch { /* */ } },
}

function locationServerConfig(): ServerConfig {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return { httpBase: '', wsBase: `${proto}//${location.host}` }
}

// Capture a token handed over in the URL fragment (#token=…) — how `trux pair`/
// `trux open` deliver it — then strip it from the address bar.
function captureFragmentToken(): void {
  const m = /[#&]token=([^&]+)/.exec(location.hash)
  if (m) {
    webStorage.set(TOKEN_KEY, decodeURIComponent(m[1]))
    history.replaceState(null, '', location.pathname + location.search)
  }
}

export async function configureNativeClient(): Promise<void> {
  captureFragmentToken()
  configureClient({ storage: webStorage, serverConfig: locationServerConfig() })
}

export function rebindHost(): void {
  configureClient({ storage: webStorage, serverConfig: locationServerConfig() })
}

// Web is same-origin: the "host" is the page origin, so only the token is stored.
export function savePair(_host: string, token: string): void {
  webStorage.set(TOKEN_KEY, token)
  rebindHost()
}
export function clearPair(): void {
  webStorage.remove(TOKEN_KEY)
  webStorage.remove(HOST_KEY)
  rebindHost()
}
export function getStoredHost(): string | null { return webStorage.get(HOST_KEY) }
export function getStoredToken(): string | null { return webStorage.get(TOKEN_KEY) }

// Pure trux-pair QR/URL parser (duplicated from ports.ts so the web bundle never
// imports the native expo-secure-store module).
export function parsePairQr(payload: string): { host: string; token: string } | null {
  try {
    const u = new URL(payload)
    const m = /[#&]token=([^&]+)/.exec(u.hash)
    if (!m) return null
    const token = decodeURIComponent(m[1])
    const host = u.host
    if (!host || !token) return null
    return { host, token }
  } catch {
    return null
  }
}
```

**Note:** this file must export the **same public surface** as `apps/mobile/src/ports.ts` (`configureNativeClient`, `rebindHost`, `savePair`, `clearPair`, `getStoredHost`, `getStoredToken`, `parsePairQr`). If `ports.ts` exports anything else that app code imports, add a web equivalent here too — check with `grep -rn "from '.*ports'" apps/mobile/app apps/mobile/src`.

- [ ] **Step 2:** Typecheck both platforms resolve:

```bash
pnpm --filter @trux/mobile typecheck && echo "typecheck OK"
```
Expected: clean (the web file is valid TS; native untouched).

- [ ] **Step 3:** Commit.

```bash
git add apps/mobile/src/ports.web.ts && git commit -m "feat(mobile): web port (localStorage + same-origin ServerConfig + #token capture)"
```

---

## Task 3: Web pairing fallback (no camera)

`app/pair.tsx` uses `expo-camera` (QR scan), which is native-only. Provide a web variant that takes the token by hand (most web users arrive via a `#token=` URL captured in Task 2, so this is the fallback).

- [ ] **Step 1:** Read `apps/mobile/app/pair.tsx` to learn its props/navigation and what it calls on success (it persists via `savePair`/the Storage port and navigates into the app).

- [ ] **Step 2:** Create `apps/mobile/app/pair.web.tsx` — a minimal screen with a token text field (and host field only if a non-same-origin setup is needed; default same-origin) that, on submit, calls the same `savePair(...)` + navigation the native screen uses. Reuse the app's existing styled components/theme; no camera, no `expo-camera` import. (Metro serves this for web and the native `pair.tsx` for native.)

- [ ] **Step 3:** Verify the web export still builds and the camera module is absent from the web bundle:

```bash
pnpm --filter @trux/mobile build:web && echo "web build OK"
```
Expected: `web build OK`.

- [ ] **Step 4:** Commit.

```bash
git add apps/mobile/app/pair.web.tsx && git commit -m "feat(mobile): web pairing fallback (manual token, no camera)"
```

> Web-push/notifications: **no code needed.** `src/notifications.ts` already degrades to no-op without an EAS `projectId` (per the C parity report), which is the dropped-web-push behaviour we want. Leave it.

---

## Task 4: Backend serves the Expo web export

- [ ] **Step 1:** In `apps/backend/src/server.ts`, change the static dir from the PWA build to the Expo web export. Replace:

```ts
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../frontend/dist')
```
with:
```ts
  // Serve the Expo web export (the single web surface). Path is relative to
  // apps/backend/src (or apps/backend/dist if compiled) → apps/mobile/dist.
  const distDir = join(dirname(fileURLToPath(import.meta.url)), '../../mobile/dist')
```
The existing `existsSync` guard + `setNotFoundHandler(... index.html)` SPA fallback stay as-is (SPA output makes them correct).

- [ ] **Step 2:** Point the build pipeline at the web export. In root `package.json`, change:

```json
    "build": "pnpm --filter @trux/frontend build",
```
to:
```json
    "build": "pnpm --filter @trux/mobile build:web",
```

In `deploy/provision.sh`, change the build line (currently `pnpm -C "$TRUX_DIR" --filter frontend build`) to:
```bash
  pnpm -C "$TRUX_DIR" --filter @trux/mobile build:web
```

In `Dockerfile`, change `pnpm --filter @trux/frontend build` to:
```dockerfile
    && pnpm --filter @trux/mobile build:web
```

- [ ] **Step 3:** Build the web surface and confirm the backend would serve it:

```bash
pnpm build && test -f apps/mobile/dist/index.html && echo "served web build present"
```
Expected: `served web build present`.

- [ ] **Step 4:** Commit.

```bash
git add apps/backend/src/server.ts package.json deploy/provision.sh Dockerfile && git commit -m "feat(web): backend serves the Expo web export; build pipeline targets it"
```

---

## Task 5: Render gate (prove it actually works in a browser)

Build ≠ runtime. This is the acceptance gate — the token-gate must pass via `localStorage` and the app must render.

- [ ] **Step 1:** Start the backend locally (auth on, a known token) serving the freshly built web export, e.g. with `~/.trux/.env` set (`TRUX_AUTH=1`, `TRUX_SECRET=…`) and `pnpm start`.

- [ ] **Step 2:** With Playwright (use the `playwright` skill), open `http://localhost:4317/#token=<TRUX_SECRET>` and verify:
  - no uncaught console error at boot (the secure-store import is gone on web; `ports.web.ts` is used),
  - the token gate passes (fragment captured → stored) and the **conversation list renders**,
  - opening a conversation renders the transcript + composer.
  Capture a mobile-viewport (390px) screenshot per the project's mobile-UX standard.

- [ ] **Step 3:** If anything throws, fix the offending web fallback (most likely another native-only import reachable from a rendered screen — add a `.web` variant or a `Platform.OS === 'web'` guard) and re-run. Do not proceed until the render gate is green.

- [ ] **Step 4:** Commit any fixes.

---

## Task 6: Delete the PWA

Only after the render gate is green.

- [ ] **Step 1:** Remove the package and scrub references:

```bash
git rm -r apps/frontend
grep -rn "@trux/frontend\|apps/frontend\|frontend/dist" --include='*.ts' --include='*.json' --include='*.sh' --include='Dockerfile' --include='*.yaml' . | grep -v node_modules
```
Resolve every hit: drop `@trux/frontend` from any remaining script/CI/workspace reference; the `server.ts` path already moved (Task 4). `pnpm-workspace.yaml`'s `apps/*` glob needs no change (the dir is just gone).

- [ ] **Step 2:** Reinstall + full check:

```bash
pnpm install && pnpm -r typecheck
```
Expected: clean; no dangling `@trux/frontend` resolution errors.

- [ ] **Step 3:** Commit.

```bash
git add -A && git commit -m "chore(web): retire the Vite PWA (apps/frontend) — Expo web is the single web surface"
```

---

## Task 7: Finish

- [ ] **Step 1:** Full green:

```bash
pnpm --filter @trux/backend exec vitest run \
  && pnpm --filter @trux/client exec vitest run \
  && pnpm --filter @trux/mobile test \
  && pnpm -r typecheck \
  && pnpm build && test -f apps/mobile/dist/index.html && echo ALL GREEN
```
Expected: backend + client + mobile suites pass, typecheck clean, web build present. (The old `@trux/frontend` suite is gone by design.)

- [ ] **Step 2:** Confirm the local **Android** build still builds (the native surface is unaffected, but the web deps share the workspace): `pnpm --filter @trux/mobile exec expo run:android` is the user's call to run on a device; at minimum re-confirm `pnpm --filter @trux/mobile typecheck`.

- [ ] **Step 3:** Merge per workflow. Use superpowers:finishing-a-development-branch to merge `feat/phase-e-expo-web` → `main` (merge when green); remove the worktree.

---

## Self-Review

**Spec/decision coverage** (against the native-migration decision's revised principle #1 and the Phase E spike findings):
- Expo web becomes the web surface → Task 1 (deps/config) + Task 4 (backend serve + build pipeline). ✓
- secure-store → localStorage web fallback → Task 2 (`ports.web.ts`). ✓
- camera/QR → manual token web fallback → Task 3 (`pair.web.tsx`); `#token=` capture → Task 2. ✓
- web-push/SW dropped on web → Task 3 note (notifications already no-op on web; no SW). ✓
- Prove it renders (not just builds) → Task 5 render gate. ✓
- Delete the PWA → Task 6. ✓
- One lane / nothing built twice afterwards → outcome of Task 6 (only `apps/mobile` remains as the view layer). ✓

**Placeholder check:** the two "read the file, then mirror it" steps (Task 2 grep for extra port exports; Task 3 read `pair.tsx`) are deliberate — they adapt to code the executor must inspect, not invented APIs. Everything else is exact.

**Consistency:** `ports.web.ts` exports the exact public surface `ports.ts` already exposes (verified against the read of `ports.ts`). The web export dir (`apps/mobile/dist`) is consistent across the `build:web` script (Task 1), the backend `distDir` (Task 4), and every verification step.
