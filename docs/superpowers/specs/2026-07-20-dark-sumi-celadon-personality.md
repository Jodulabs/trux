# Trux visual personality — Dark sumi + celadon

*Status: approved direction (approach B). Steering artifact for the theme retoken.*  
*Date: 2026-07-20*

---

## 1. Intent

Replace the warm copper “field console” accent (Claude-adjacent orange) with a **dark sumi + celadon** personality: simple, monk-like, restrained. Design serves the product (chat / agent instrument), not a marketing surface.

**Scene:** Developer glances at an approval on a phone in a dim room, decides, pockets it. Calm focus. No alarm aesthetic.

**Approach B (locked):** Token rewrite + quieter craft (radius, accent discipline, cooler user bubbles). Keep IBM Plex. No new mark, no typeface swap, no copy rewrite in this pass.

---

## 2. Non-goals

- Light / stone cloister theme
- Full rebrand (new logo, display fonts, empty-state copy rewrite)
- Decorative celadon washes, gradients, glow
- Changing interaction patterns from the UX polish pass (pinned approvals, scroll FAB, etc.)

---

## 3. Palette (restrained)

| Token | Value | Role |
|---|---|---|
| `ink` | `#0b0c0b` | Ground — green-black sumi, not blue-black |
| `surface1` | `#131514` | Raised panel |
| `surface2` | `#1c1e1c` | Nested panel |
| `surface3` | `#252825` | Pressed / chip rest |
| `line` | `#2c302c` | Borders |
| `lineSoft` | `#1f221f` | Dividers |
| `text` | `#e4e6e2` | Primary prose (soft paper) |
| `textDim` | `#9a9f98` | Secondary |
| `textFaint` | `#5e635c` | Tertiary / idle |
| `accent` | `#8fbc8f` | Celadon — primary actions only |
| `accentBright` | `#a8cfa8` | Hover / thinking liveness |
| `accentSoft` | `rgba(143, 188, 143, 0.14)` | Soft fills |
| `userSurface` | `#161a18` | User bubble fill |
| `userBorder` | `#2a312c` | User bubble edge |
| `ok` | `#7d9f7d` | Success (muted sage) |
| `warn` | `#c4a574` | Warning (soft amber, not loud) |
| `error` | `#c47f7a` | Error (soft clay) |

**Accent discipline:** Celadon only for send / primary CTA, selected chips, streaming caret, thinking & awaiting-approval status dots. Never as large background decoration.

**Status dots:** `idle` → `textFaint`; `thinking` / `awaiting_approval` → `accent` / `accentBright`; `error` → `error`.

---

## 4. Type & shape

- **Fonts:** Keep `IBM Plex Sans` + `IBM Plex Mono` (human prose vs machine tokens).
- **Radius:** Quieter — `radius: 8`, `radiusSm: 5`, `radiusLg: 16` (was 11 / 7 / 22).
- **Mark:** Keep `✳` for this pass; color becomes celadon via `theme.accent`.

---

## 5. Anti-references

- No warm copper / orange (`#e8843d`, `#f6a05a`, or cousins)
- No purple glow, acid neon green, SaaS cream + terracotta
- No glassmorphism or gradient text

---

## 6. Implementation surface

Single source of truth: `apps/mobile/src/theme.ts`. All screens already consume `theme.*`. No parallel CSS `:root` in the Expo mobile app.

Verify after change: home header mark, composer send, status dots, approval card border, streaming caret, settings primary border — all celadon; no residual copper hexes in mobile UI source.

---

## 7. Success criteria

1. Side-by-side with Claude mobile: accent family is clearly not warm orange.
2. UI still reads as a calm dark tool (monk, not spa, not crypto terminal).
3. Existing UX polish behaviors unchanged; only visual tokens + radius.
4. Mobile typecheck + Jest suite still green.
