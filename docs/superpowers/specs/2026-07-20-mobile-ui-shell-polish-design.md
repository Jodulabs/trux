# Mobile UI shell polish — Design Spec

**Status:** implemented  
**Date:** 2026-07-20  
**Order:** A → B → C → D

## Goals

- Reduce home header icon overload (mystery glyphs)
- Make conversation send control visible when enabled and disabled
- Fix provider Connect (wrong URL / open-link failures)
- Let users pick a project folder by browsing the host filesystem from home

## A — Home chrome

Header: brand + **New project** only. One **⋯** opens an action sheet with labeled **Providers** and **Settings**. Empty state keeps Create CTA. Desktop sidebar footer gets the same labeled links (not three header icons).

## B — Send button

Enabled: brighter celadon fill + subtle border, dark ↑. Disabled: outlined (`line` border, dim ↑) so the control remains findable. Composer bar background `surface1`.

## C — Provider Connect

Device-login state keyed by `providerId` (clear on switch / new Connect). Auto-open verify URL on Connect; primary **Open browser** + **Copy link**; surface failure if open fails. Claude paste-code + poll unchanged functionally.

## D — Project path browser

`GET /fs/dirs?path=` lists child directories under allowed roots (`$HOME` and `TRUX_WORKSPACES`). New-project UI: breadcrumb + folder list → **Use this folder**; name defaults to basename. Manual paste remains secondary.

## Out of scope

Bottom tabs, auth QR, whole-disk browsing, OS-native desktop folder picker.
