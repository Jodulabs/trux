# Phase 6 — Diff / file / git (plan)

Spec: `docs/superpowers/specs/2026-06-17-trux-v2-design.md` §5 P1 #10, rows "Edit/Write diff cards + full-width DiffView", "Git route + GitPanel", "Git status badge", phase list "Phase 6".

**Goal:** Review and commit the agent's work end-to-end from the phone. Trux's edge over a terminal. Every tool_result is a `<pre>` dump today.

## Backend — a safe git seam

New module `apps/backend/src/git.ts`: thin `execFile` wrappers over a conversation's cwd, **safe ops only**. No `reset --hard`, `push`, `rebase`, `checkout --` — a fat-finger there is unrecoverable from a phone.
- `gitStatus(cwd)` → `{ branch, ahead, behind, dirty, files: {path, index, work, staged}[] }` from `git status --porcelain=v1 --branch` + ahead/behind parse.
- `gitDiff(cwd, {path?, staged?})` → unified diff text (`git diff` / `git diff --staged`, optional pathspec).
- `gitStage(cwd, path)` → `git add -- <path>`; `gitUnstage(cwd, path)` → `git restore --staged -- <path>`.
- `gitCommit(cwd, message)` → `git commit -m <message>` (only staged). Returns `{ ok, hash?, error? }`.
- All reject paths with `..`/absolute escapes; all swallow non-repo into a typed `{repo:false}` rather than throwing.

Routes (`routes.ts`, behind the same bearer hook):
- `GET /conversations/:id/git` → status (resolves cwd from the conversation).
- `GET /conversations/:id/git/diff?path=&staged=` → `{ diff }`.
- `POST /conversations/:id/git/stage` `{path}` / `/unstage` `{path}` / `/commit` `{message}`.
All resolve the conversation's cwd from the registry; 404 if unknown.

## Protocol / types

Add to `rest.ts`: `GitStatus`, `GitFileStatus`. (Diff is just a string.)

## Frontend

- `parseDiff` util (`apps/frontend/src/diff.ts`) → hunks/lines for rendering + `+N/-M` counts. Tested in isolation.
- `DiffView.tsx` (new): full-width unified diff with line gutters and add/del tint. Modal on mobile (`pointer: coarse`), side panel ≥640px. Opened from an Edit/Write card or the GitPanel.
- Transcript: detect `tool_call` of `Edit`/`Write`/`MultiEdit` → a compact diff-preview chip (filename + `+N/-M`) that opens DiffView for that file (diff sourced from the live `git diff` of the path, since the tool input isn't a unified diff). Keep it inside ActivityGroup's step rendering minimal; simplest: a "view diff" affordance on edit tool steps.
- `GitPanel.tsx` (new): lists changed files (staged/unstaged), stage/unstage toggles, a commit message box (with an "AI suggested message" prefill from the latest assistant text / a simple heuristic), Commit button. Safe ops only.
- `ConversationView`: a dirty/ahead/behind **git badge** in the conversation bar that opens the GitPanel; polled on turn_complete + on open.
- `api.ts`: git endpoints.

## Tasks (TDD, per-task commit)
1. **`git.ts` safe wrappers** + `git.test.ts` against a real temp repo (init, write, status/diff/stage/commit/unstage; path-escape rejection; non-repo handling).
2. **Git routes** + `routes.test.ts` (status/diff/stage/commit happy + 404 + malformed).
3. **Protocol types** (`rest.ts`) + **`api.ts`** git methods.
4. **`diff.ts` parser** + `diff.test.ts` (+N/-M counts, hunk/line classification).
5. **`DiffView` + `GitPanel`** components + a focused component test (renders files, stage toggles call api, commit calls api).
6. **Conversation bar git badge + Edit-card diff affordance** wiring + test.

## Notes
- Commit author/identity uses the repo's existing git config; no `--author` override.
- AI commit message: v1 = prefill from a heuristic (first line of latest assistant text, trimmed) with the box fully editable. No new model call.
