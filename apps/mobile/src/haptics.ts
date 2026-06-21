import * as Haptics from 'expo-haptics'

// Native mirror of the PWA's haptics.ts — same Tap vocabulary so call sites in
// the shared spine / views don't branch on platform. expo-haptics drives the
// iOS Taptic Engine and Android vibration; degrades silently when unavailable.
type Tap = 'light' | 'medium' | 'success' | 'error' | 'notify'

const IMPACT: Record<Tap, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  success: Haptics.ImpactFeedbackStyle.Medium,
  error: Haptics.ImpactFeedbackStyle.Heavy,
  notify: Haptics.ImpactFeedbackStyle.Rigid,
}

// notify/success/error use the notification API (patterned) so they read as a
// distinct event, not a single impact tick — matching the PWA's multi-pulse
// patterns. The others use impactAsync.
export function haptic(tap: Tap): void {
  try {
    if (tap === 'success') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } else if (tap === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
    } else if (tap === 'notify') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
    } else {
      void Haptics.impactAsync(IMPACT[tap])
    }
  } catch {
    // no-op: haptics unsupported or blocked
  }
}
