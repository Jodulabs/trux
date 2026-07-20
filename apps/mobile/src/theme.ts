// Theme tokens — dark sumi + celadon (monk / restrained).
// Spec: docs/superpowers/specs/2026-07-20-dark-sumi-celadon-personality.md
// Celadon is for primary actions and liveness only; never decorative washes.

export const theme = {
  ink: '#0b0c0b',
  surface1: '#131514',
  surface2: '#1c1e1c',
  surface3: '#252825',
  line: '#2c302c',
  lineSoft: '#1f221f',

  text: '#e4e6e2',
  textDim: '#9a9f98',
  textFaint: '#5e635c',

  accent: '#8fbc8f',
  accentBright: '#a8cfa8',
  accentSoft: 'rgba(143, 188, 143, 0.14)',

  userSurface: '#161a18',
  userBorder: '#2a312c',

  ok: '#7d9f7d',
  warn: '#c4a574',
  error: '#c47f7a',

  radius: 8,
  radiusSm: 5,
  radiusLg: 16,

  fontSans: 'IBM Plex Sans',
  fontMono: 'IBM Plex Mono',
} as const

export type Theme = typeof theme

// Status dots: idle ash; thinking / needs-you = celadon; error = clay.
export const STATUS_COLORS: Record<string, string> = {
  idle: theme.textFaint,
  thinking: theme.accent,
  awaiting_approval: theme.accentBright,
  error: theme.error,
}
