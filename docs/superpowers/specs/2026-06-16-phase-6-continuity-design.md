# Phase 6 — Continuity & polish

*Branch: `phase-6-continuity` · Companion: [roadmap](../../../docs/2026-06-16-trux-roadmap.md)*

---

## Goal

Start a conversation at the desk, continue it on the phone. Secondary: rename, search, image attachments, snippets.

---

## 1. Session adoption

### Discovery endpoint

`GET /sessions/discover?agent=claude|codex&cwd=<path>` — server-side scan of native agent storage.

**Claude**: reconstruct the project folder name from `cwd`. Claude encodes the absolute path as `/-<path-with-slashes-replaced-by-hyphens>`, e.g. `/home/gp/foo` → `--home-gp-foo`. Walk `~/.claude/projects/<folderName>/` listing `.jsonl` files, read first line of each, extract `sessionId` + `timestamp`. Return newest-first, cap at 10.

**Codex**: spawn `codex session list --json`, parse stdout, filter by `cwd`.

**OpenCode**: skip Phase 6 (no documented discovery API).

Returns `[{ sessionId, updatedAt }]` or `[]` if the directory doesn't exist.

### Protocol extension

Add `native_session_id?: string` to `CreateConversationRequest`. The backend stores it and passes it as `resume` to `AgentAdapter.start()`.

### Frontend picker

`NewConversationDialog`: after agent + cwd are selected, call `api.discoverSessions()`. If non-empty, show a "Resume session" dropdown (relative timestamps). Default: "Start fresh". Selected session → `native_session_id` in the POST body.

---

## 2. Rename conversations

`PATCH /conversations/:id` extended with `title?: string`. `registry.renameConversation(id, title)` — one SQL UPDATE. Sidebar: double-click title → inline `<input>` (blur commits, Escape cancels).

---

## 3. Full-text search (FTS5)

Add `fts_events` as FTS5 content table over `events`. `appendEvent` inserts `user_text`, `text`, and `tool_result.output` rows. `GET /conversations/search?q=<text>` queries FTS5 with `snippet()`, returns `[{ conversation, snippet }]`.

Frontend: debounced search input at top of sidebar; non-empty query replaces conversation list with search results.

---

## 4. Image attachments (user → agent)

Extend `user_message` WS message with `attachments?: ImageAttachment[]`. Base64 inline (no HTTP upload). Pass through `stream.ts → manager → session.send`.

Per adapter:
- **Claude**: multi-part HumanTurn content array `[imageBlock, ..., textBlock]`
- **Codex**: write temp files, pass `-i <path>` args, clean up on proc close
- **OpenCode**: log + drop (image API unconfirmed for Phase 6)

Composer: hidden file input + paperclip button, FileReader to base64, thumbnail preview, clear on send.

---

## 5. Saved snippets (frontend-only)

`useSnippets` hook backed by `localStorage['trux_snippets']`. `SnippetsPanel` in sidebar — click a snippet to insert text into the composer. No backend. No cross-device sync in Phase 6.

---

## Files changed

| File | Action |
|---|---|
| `packages/protocol/src/rest.ts` | `native_session_id?` on CreateConversationRequest; search result type |
| `apps/backend/src/db.ts` | FTS5 virtual table in schema |
| `apps/backend/src/registry.ts` | `renameConversation`, `searchConversations`, extend `createConversation` |
| `apps/backend/src/routes.ts` | `GET /sessions/discover`, extend PATCH, `GET /conversations/search` |
| `apps/backend/src/adapter/types.ts` | `send(text, attachments?)` |
| `apps/backend/src/adapter/claude.ts` | multi-part content for images |
| `apps/backend/src/adapter/codex.ts` | temp file `-i` args |
| `apps/backend/src/adapter/opencode.ts` | drop + log |
| `apps/backend/src/manager.ts` | pass attachments through |
| `apps/backend/src/stream.ts` | extract attachments from msg |
| `apps/frontend/src/api.ts` | `discoverSessions`, `patchConversation`, `searchConversations` |
| `apps/frontend/src/store.ts` | `renameConversation`, `searchQuery`, `search` |
| `apps/frontend/src/truxClient.ts` | `sendUserMessage(text, attachments?)` |
| `apps/frontend/src/components/NewConversationDialog.tsx` | session picker |
| `apps/frontend/src/components/Sidebar.tsx` | inline rename + search |
| `apps/frontend/src/components/Composer.tsx` | file input + thumbnails |
| `apps/frontend/src/hooks/useSnippets.ts` | NEW |
| `apps/frontend/src/components/SnippetsPanel.tsx` | NEW |
| `docs/2026-06-16-trux-roadmap.md` | check off Phase 6 |
