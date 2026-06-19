// Physical confirmation for the glance-at-my-phone loop. navigator.vibrate is
// Android-PWA only (iOS Safari ignores it) — degrade silently. Patterns are short
// so they read as a "tick" not a buzz.
type Tap = 'light' | 'medium' | 'success' | 'error' | 'notify'

const PATTERNS: Record<Tap, number | number[]> = {
  light: 8,
  medium: 18,
  success: [10, 40, 10],
  error: [30, 40, 30],
  notify: [12, 60, 12, 60, 12],
}

export function haptic(tap: Tap): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(PATTERNS[tap])
    }
  } catch {
    // no-op: vibration unsupported or blocked
  }
}
