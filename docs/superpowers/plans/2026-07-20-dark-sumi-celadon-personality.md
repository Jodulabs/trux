# Dark sumi + celadon personality — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retoken the Expo mobile UI from warm copper to dark sumi + celadon per `docs/superpowers/specs/2026-07-20-dark-sumi-celadon-personality.md`.

**Architecture:** Single source of truth is `apps/mobile/src/theme.ts`. Update the theme contract test, then regenerate terminal HTML so the xterm cursor matches. No component redesign.

**Tech Stack:** Expo / React Native, Jest, `gen:terminal-html` script.

**Spec:** `docs/superpowers/specs/2026-07-20-dark-sumi-celadon-personality.md`

---

### Task 1: Theme tokens + contract test

**Files:**
- Modify: `apps/mobile/src/theme.ts`
- Modify: `apps/mobile/src/ports.test.ts`

- [ ] **Step 1:** Update `ports.test.ts` expectations to celadon / sumi values (TDD: fail first).
- [ ] **Step 2:** Rewrite `theme.ts` per spec (palette + quieter radius + comment).
- [ ] **Step 3:** Run `ports.test.ts` — expect pass.
- [ ] **Step 4:** Commit.

### Task 2: Terminal theme parity

**Files:**
- Modify: `apps/mobile/scripts/gen-terminal-html.mjs`
- Regenerate: `apps/mobile/src/components/terminalHtml.generated.ts`

- [ ] **Step 1:** Point background / foreground / cursor at new ink / text / accent.
- [ ] **Step 2:** Run `pnpm --filter @trux/mobile gen:terminal-html` (or node script directly).
- [ ] **Step 3:** Grep mobile for residual copper hexes — expect none in UI source.
- [ ] **Step 4:** Commit.

### Task 3: Verify

- [ ] Run mobile Jest + typecheck.
- [ ] Final commit if any leftover comment fixes (`QrScanner.tsx` copper wording).
