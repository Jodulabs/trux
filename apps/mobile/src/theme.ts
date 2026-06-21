// Theme tokens for the native app — mirrors the Vite PWA's index.css :root.
// Ink surfaces, warm copper accent, IBM Plex Sans/Mono. Kept in one place so
// the native shell reads as the same product without a CSS layer.

export const theme = {
  ink: '#0c0d10',
  surface1: '#14161b',
  surface2: '#1b1e25',
  surface3: '#232730',
  line: '#2a2f39',
  lineSoft: '#1f232b',

  text: '#e7e4dd',
  textDim: '#9aa1ab',
  textFaint: '#646b76',

  accent: '#e8843d',
  accentBright: '#f6a05a',
  // RN doesn't take CSS rgba() strings in StyleSheet directly; use the hex with
  // alpha where needed, or a dedicated soft token.
  accentSoft: 'rgba(232, 132, 61, 0.13)',

  userSurface: '#1c2632',
  userBorder: '#2c3a4c',

  ok: '#6fcf8e',
  warn: '#f0b429',
  error: '#ef6f6c',

  radius: 11,
  radiusSm: 7,
  radiusLg: 22,

  fontSans: 'IBM Plex Sans',
  fontMono: 'IBM Plex Mono',
} as const

export type Theme = typeof theme

// Status dot colors mirror the PWA's .dot.<state> rules.
export const STATUS_COLORS: Record<string, string> = {
  idle: theme.textFaint,
  thinking: theme.accent,
  awaiting_approval: theme.accent,
  error: theme.error,
}
