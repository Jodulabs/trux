# Phase 9 — Mobile-First Chat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign trux's UI to a mobile-first, claude.ai-style chat interface — one collapsible icon rail on every screen, a centered conversation column, a floating composer card, auto-generated conversation titles, and a greeting empty state — while preserving trux's agent / repo / approval / git features.

**Architecture:** Frontend-only. No protocol or backend changes; conversation titles reuse the existing `PATCH /conversations/:id` route (`apps/backend/src/routes.ts:242`). The app shell becomes: a fixed narrow **icon rail** (always visible, ~56px) + a slide-over **conversation list** (titled) + a centered **main column** (transcript + floating composer). On mobile the rail collapses into a top-bar hamburger; the list is the off-canvas drawer already in place. State for "list open" and "current conversation" stays in `App.tsx` + the Zustand store.

**Tech Stack:** React 19, Zustand, Vite, vitest + happy-dom (component tests, see `apps/frontend/test/components.test.tsx`), CSS custom properties in `apps/frontend/src/index.css`.

**Reference:** claude.ai / ChatGPT — calm, centered, warm-dark, focus-protecting. Mobile is the product; desktop is the same column with more breathing room.

**Baseline:** branch `fix/mobile-access-and-workspace-picker` at commit `5dbe374` (phone fixes + workspace picker + mobile drawer). Step A (centered column + floating composer card) is already applied on top, uncommitted.

**Verification convention:** after each visual task, rebuild (`pnpm --filter @trux/frontend build`), ensure the backend is running (`pnpm --filter @trux/backend dev`), and screenshot at 390×844 with `google-chrome --headless=new --screenshot` (drive clicks via the CDP snippet in `/tmp/cdp-drawer.mjs`; Node 22 has global `WebSocket`). Run `pnpm test` before each commit.

---

## File Structure

- **Create** `apps/frontend/src/components/Rail.tsx` — the always-visible narrow icon rail (mark, new, conversations, search).
- **Create** `apps/frontend/src/components/ConversationList.tsx` — the slide-over titled list panel (extracted from today's `Sidebar.tsx`), with search.
- **Modify** `apps/frontend/src/components/NewConversationDialog.tsx` → repurpose as the empty-state **NewConversationPanel** (agent + repo pickers + a create affordance), no longer permanently in the sidebar.
- **Modify** `apps/frontend/src/App.tsx` — orchestrate rail + list + main; `listOpen` state; greeting empty state; `titleOf` display helper.
- **Modify** `apps/frontend/src/store.ts` — add `title` to `ConvMeta`, a `setTitle` action, and persist a title to a conversation in `conversations`.
- **Modify** `apps/frontend/src/api.ts` — add `renameConversation(id, title)`.
- **Modify** `apps/frontend/src/components/ConversationView.tsx` — on first user message of an untitled conversation, derive + persist a title.
- **Modify** `apps/frontend/src/index.css` — rail, list panel, greeting, composer refinements.
- **Delete** `apps/frontend/src/components/Sidebar.tsx` once its content is split into Rail + ConversationList.
- **Modify** `apps/frontend/test/components.test.tsx` — tests for titles, list, rail.

Today's `Sidebar.tsx` already contains the conversation list + search; the redesign splits it into `Rail` (icons) + `ConversationList` (titled list), and moves the agent/repo pickers out to the empty state.

---

## Task 1: Conversation title — API + store plumbing

**Files:**
- Modify: `apps/frontend/src/api.ts`
- Modify: `apps/frontend/src/store.ts`
- Test: `apps/frontend/test/store.test.ts`

- [ ] **Step 1: Write the failing test** — append to `apps/frontend/test/store.test.ts`:

```ts
import { useStore } from '../src/store'

it('setTitle updates the conversation in the list and convMeta', () => {
  useStore.setState({
    conversations: [
      { id: 'c1', agent: 'claude', cwd: '/repo/darshi', title: null, status: 'idle',
        native_session_id: null, archived: false, created_at: 1, updated_at: 1 },
    ],
    convMeta: {},
  })
  useStore.getState().setTitle('c1', 'Fix auth redirect')
  expect(useStore.getState().conversations[0]?.title).toBe('Fix auth redirect')
  expect(useStore.getState().convMeta['c1']?.title).toBe('Fix auth redirect')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/frontend test store -t "setTitle"`
Expected: FAIL — `setTitle is not a function`.

- [ ] **Step 3: Add `title` to `ConvMeta` and the `setTitle` action** in `apps/frontend/src/store.ts`:

In the `ConvMeta` type add `title?: string`. In the `TruxState` interface add `setTitle: (id: string, title: string) => void`. Implement in the store object:

```ts
  setTitle(id, title) {
    set({
      conversations: get().conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    })
    const prev = get().convMeta[id]
    if (prev) set({ convMeta: { ...get().convMeta, [id]: { ...prev, title } } })
    else get().setConvMeta(id, { title })
  },
```

- [ ] **Step 4: Add the API method** in `apps/frontend/src/api.ts` after `createConversation`:

```ts
  renameConversation: (id: string, title: string) =>
    fetch(`/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ title }),
    }).then(json<Conversation>),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @trux/frontend test store -t "setTitle"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/store.ts apps/frontend/src/api.ts apps/frontend/test/store.test.ts
git commit -m "feat(v2): conversation title store + rename API"
```

---

## Task 2: Auto-title from the first user message

**Files:**
- Modify: `apps/frontend/src/components/ConversationView.tsx`
- Test: `apps/frontend/test/components.test.tsx`

A title is derived client-side from the first user message, persisted via `api.renameConversation`, and reflected in the store via `setTitle`. "First message" = the conversation currently has no `user_text` in its transcript and no title.

- [ ] **Step 1: Write the failing test** in `apps/frontend/test/components.test.tsx`:

```tsx
import { deriveTitle } from '../src/components/ConversationView'

describe('deriveTitle', () => {
  it('takes the first line, trims, and caps at 60 chars', () => {
    expect(deriveTitle('Fix the auth redirect\nmore detail')).toBe('Fix the auth redirect')
    expect(deriveTitle('  hello world  ')).toBe('hello world')
    expect(deriveTitle('x'.repeat(80))).toHaveLength(60)
    expect(deriveTitle('')).toBe('')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @trux/frontend test components -t "deriveTitle"`
Expected: FAIL — `deriveTitle is not exported`.

- [ ] **Step 3: Implement and export `deriveTitle`** in `apps/frontend/src/components/ConversationView.tsx` (module scope):

```ts
export function deriveTitle(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? ''
  const t = firstLine.trim()
  return t.length > 60 ? t.slice(0, 60) : t
}
```

- [ ] **Step 4: Wire it into `onSend`** in `ConversationView.tsx`. Read the current conversation + `setTitle` from the store near the other selectors:

```ts
  const conversations = useStore((s) => s.conversations)
  const setTitle = useStore((s) => s.setTitle)
```

At the **start** of `onSend`, before sending:

```ts
    const conv = conversations.find((c) => c.id === id)
    const noUserYet = !transcript.some((it) => it.type === 'user_text')
    if (conv && !conv.title && noUserYet) {
      const title = deriveTitle(text)
      if (title) {
        setTitle(id, title)
        void api.renameConversation(id, title).catch(() => {})
      }
    }
```

- [ ] **Step 5: Run the suite to verify it passes and nothing regressed**

Run: `pnpm --filter @trux/frontend test`
Expected: PASS (existing 61 + new title tests).

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/ConversationView.tsx apps/frontend/test/components.test.tsx
git commit -m "feat(v2): auto-title a conversation from its first message"
```

---

## Task 3: Display titles everywhere (list + mobile bar)

**Files:**
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/components/Sidebar.tsx`

A shared display helper prefers a live/stored title over the cwd basename.

- [ ] **Step 1: Add `titleOf` to `App.tsx`** (module scope, replacing the local `shortCwd` use in `mobileTitle`):

```ts
function titleOf(c: Conversation): string {
  return c.title ?? shortCwd(c.cwd)
}
```

Use it for `mobileTitle`: `const mobileTitle = current ? titleOf(current) : 'trux'`.

- [ ] **Step 2: Use the title in the list** — in `apps/frontend/src/components/Sidebar.tsx`, the list item already renders `{c.title ?? shortCwd(c.cwd)}`. Confirm it now shows real titles (no code change needed because Task 1 updates `conversations[].title`). If `convMeta` holds a fresher title, prefer it: change the title span to `{convMeta[c.id]?.title ?? c.title ?? shortCwd(c.cwd)}`.

- [ ] **Step 3: Verify in the browser**

Rebuild, open a conversation, send a first message, and confirm the list item + top bar update from `darshi` to the message-derived title. Screenshot at 390px.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/src/components/Sidebar.tsx
git commit -m "feat(v2): show conversation titles in the list and top bar"
```

---

## Task 4: Extract the icon Rail (always visible)

**Files:**
- Create: `apps/frontend/src/components/Rail.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/index.css`

The rail is a fixed ~56px column on every screen: trux mark (top), new-chat `+`, conversations toggle (opens the list), search (opens the list focused on search). On mobile it folds into the existing top-bar hamburger (keep the `mobile-bar`; the rail is `display:none` below 640px).

- [ ] **Step 1: Create `apps/frontend/src/components/Rail.tsx`:**

```tsx
interface Props {
  onNew: () => void
  onToggleList: () => void
}

export function Rail({ onNew, onToggleList }: Props): React.ReactElement {
  return (
    <nav className="rail" data-testid="rail" aria-label="Primary">
      <span className="rail-mark" aria-hidden>▰</span>
      <button className="rail-btn" data-testid="rail-new" aria-label="New conversation" onClick={onNew}>＋</button>
      <button className="rail-btn" data-testid="rail-list" aria-label="Conversations" onClick={onToggleList}>☰</button>
    </nav>
  )
}
```

- [ ] **Step 2: Render the rail in `App.tsx`** as the first child of `.app`, before the list. Add `listOpen` state (`const [listOpen, setListOpen] = useState(false)`), and an `onNew` that clears the current conversation and closes the list:

```tsx
  const onNew = (): void => { void selectConversation(''); setListOpen(false) }
```

(Selecting `''` is a no-op id; guard `selectConversation` to treat a falsy id as "show empty state": at its top, `if (!id) { set({ currentId: null }); return }`.)

- [ ] **Step 3: Add rail CSS** in `index.css`:

```css
.rail {
  flex: 0 0 56px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 0.7rem 0;
  background: var(--surface-1);
  border-right: 1px solid var(--line-soft);
}
.rail-mark { color: var(--accent); font-size: 1.1rem; margin-bottom: 0.4rem; }
.rail-btn {
  width: 40px; height: 40px;
  display: grid; place-items: center;
  background: none; border: 1px solid transparent; border-radius: var(--radius-sm);
  color: var(--text-dim); font-size: 1.2rem; cursor: pointer;
}
.rail-btn:hover { background: var(--surface-2); color: var(--text); }
@media (max-width: 640px) { .rail { display: none; } }
```

- [ ] **Step 4: Verify** the rail shows on desktop, mobile still uses the hamburger. Screenshot desktop (1280px) + mobile (390px).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/Rail.tsx apps/frontend/src/App.tsx apps/frontend/src/index.css
git commit -m "feat(v2): always-visible icon rail"
```

---

## Task 5: Conversation list becomes a slide-over (collapsed by default everywhere)

**Files:**
- Create: `apps/frontend/src/components/ConversationList.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/index.css`
- Delete: `apps/frontend/src/components/Sidebar.tsx`

Move the titled list + search out of `Sidebar.tsx` into `ConversationList.tsx`. It is **closed by default** on every screen (this is the "don't fill space just because it exists" fix). The rail's ☰ and the mobile hamburger both toggle `listOpen`. Backdrop dims the main column; selecting closes it. The agent/repo pickers do **not** live here anymore (Task 6).

- [ ] **Step 1: Create `ConversationList.tsx`** by copying the list + search markup from `Sidebar.tsx` (the `<div className="sidebar-search">` and `<ul className="conversation-list">` blocks and their logic: `searchQ`, `searchResults`, `displayList`, `convMeta`, the title/badge/dot rendering). Wrap in `<aside className="conv-list" data-testid="conversation-list-panel">`. Props: `{ conversations, currentId, onSelect }`. Keep `data-testid="conversation-list"` on the `<ul>`.

- [ ] **Step 2: Update `App.tsx`** to render `<ConversationList>` gated by `listOpen`, with a backdrop:

```tsx
      {listOpen ? (
        <>
          <ConversationList conversations={conversations} currentId={currentId} onSelect={pick} />
          <div className="drawer-backdrop" data-testid="list-backdrop" onClick={() => setListOpen(false)} />
        </>
      ) : null}
```

Update `pick` to also `setListOpen(false)`. The mobile hamburger's `onClick` becomes `() => setListOpen(true)`; drop the old `drawerOpen` state in favour of `listOpen`. Remove the `<Sidebar>` import/usage.

- [ ] **Step 3: CSS** — rename the mobile drawer rules from `.sidebar` to `.conv-list`, and make it a slide-over on **all** widths (anchored after the 56px rail on desktop):

```css
.conv-list {
  position: fixed;
  top: 0; bottom: 0; left: 0;
  width: min(86vw, 320px);
  display: flex; flex-direction: column;
  background: var(--surface-1);
  border-right: 1px solid var(--line-soft);
  box-shadow: 2px 0 18px rgba(0,0,0,0.45);
  z-index: 50;
  padding-top: env(safe-area-inset-top, 0px);
  animation: slidein 0.18s ease both;
}
@media (min-width: 641px) { .conv-list { left: 56px; } }
@keyframes slidein { from { transform: translateX(-8px); opacity: 0; } to { transform: none; opacity: 1; } }
```

Remove the now-unused `.sidebar` mobile block. Keep `.drawer-backdrop`.

- [ ] **Step 4: Delete `Sidebar.tsx`** and fix any remaining import.

- [ ] **Step 5: Run tests + verify** — `pnpm --filter @trux/frontend test`; screenshot list open on mobile + desktop (drive ☰ click via CDP).

- [ ] **Step 6: Commit**

```bash
git add -A apps/frontend/src
git commit -m "feat(v2): conversation list as a slide-over, collapsed by default on every screen"
```

---

## Task 6: Greeting empty state + new-conversation panel

**Files:**
- Modify: `apps/frontend/src/components/NewConversationDialog.tsx`
- Modify: `apps/frontend/src/App.tsx`
- Modify: `apps/frontend/src/index.css`

When `currentId` is null, the main column shows a centered greeting + the agent/repo pickers + a Create button (the existing `NewConversationDialog`, restyled). This is the only place the pickers live now.

- [ ] **Step 1: Greeting markup** — in `App.tsx`, replace the `data-testid="empty"` paragraph with:

```tsx
          <div className="empty-state" data-testid="empty">
            <div className="greeting">
              <span className="greeting-mark">✳</span>
              <h1>What should we build?</h1>
            </div>
            <NewConversationDialog onCreated={(id) => void onCreated(id)} />
          </div>
```

- [ ] **Step 2: CSS** for the centered greeting + restyled picker row:

```css
.empty-state {
  margin: auto;
  width: 100%; max-width: var(--col);
  padding: 1.5rem;
  display: flex; flex-direction: column; align-items: center; gap: 1.4rem;
}
.greeting { display: flex; align-items: center; gap: 0.6rem; color: var(--text); }
.greeting-mark { color: var(--accent); font-size: 1.6rem; }
.greeting h1 { font-family: var(--font-display); font-weight: 500; font-size: 1.8rem; }
.new-conversation { flex-direction: row; flex-wrap: wrap; justify-content: center; gap: 0.5rem; width: 100%; }
```

(Confirm the existing `.new-conversation select` / `.create` rules still read well centered; tighten widths if needed.)

- [ ] **Step 3: Verify** the empty state on mobile (390px) and desktop. Screenshot.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/App.tsx apps/frontend/src/components/NewConversationDialog.tsx apps/frontend/src/index.css
git commit -m "feat(v2): greeting empty state with the new-conversation panel"
```

---

## Task 7: Final polish pass + full verification

**Files:**
- Modify: `apps/frontend/src/index.css` (spacing/typography tuning)
- Modify: `apps/frontend/test/components.test.tsx`

- [ ] **Step 1: Keyboard-avoidance check** — on a real phone the composer must stay above the on-screen keyboard. Verify `.app { height: 100dvh }` plus the composer's `env(safe-area-inset-bottom)` behave with the keyboard open; if the composer is hidden, switch the app height to `100svh` and retest. (Document the result either way.)

- [ ] **Step 2: Test the title test ids** — add a component test asserting the list shows a real title after `setTitle`:

```tsx
it('renders a conversation title once set', () => {
  useStore.setState({ conversations: [{ id: 'c1', agent: 'claude', cwd: '/x/darshi', title: 'Fix auth', status: 'idle', native_session_id: null, archived: false, created_at: 1, updated_at: 1 }], convMeta: {} })
  render(<ConversationList conversations={useStore.getState().conversations} currentId={null} onSelect={() => {}} />)
  expect(screen.getByText('Fix auth')).toBeTruthy()
})
```

- [ ] **Step 3: Full suite + typecheck**

Run: `pnpm test && pnpm -r typecheck`
Expected: all green.

- [ ] **Step 4: Desktop + mobile screenshots** of: empty state, a titled conversation, list open. Confirm against the claude.ai reference (collapsed rail, centered column, floating composer, real titles).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(v2): mobile redesign polish + tests"
```

---

## Self-Review

- **Spec coverage:** collapsible rail (T4) + list slide-over collapsed-by-default (T5) ✓; centered column + composer card (Step A, pre-applied) ✓; conversation titles (T1–T3) ✓; greeting empty state (T6) ✓; agent/repo pickers preserved in the new-conversation panel (T6) ✓; keyboard avoidance (T7) ✓. Approvals/git/preview are untouched and continue to render inside `ConversationView`.
- **Type consistency:** `setTitle(id, title)`, `ConvMeta.title?`, `deriveTitle(text)`, `renameConversation(id, title)`, `titleOf(c)` used consistently across tasks.
- **No backend/protocol change:** titles ride the existing `PATCH /conversations/:id`.
- **Risk:** `selectConversation('')` must short-circuit to the empty state (guard added in T4 Step 2) — verify no other caller passes an empty id.
