import { AppState } from 'react-native'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { api } from '@trux/client/api'
import { useStore } from '@trux/client/store'
import { getStoredHost, getStoredToken } from './ports'

// Native push, mirroring the PWA's service-worker behaviours (apps/frontend/
// public/sw.js) on the same backend emit path. The box sends a notification
// when an agent needs you (approval) or finishes a turn; the payload carries
// `{ conversationId, kind }` (see backend push.ts NotifyInput → ExpoPushMessage).
// Three behaviours to rebuild natively: (1) register a device token, (2)
// deep-link to the conversation on tap, (3) suppress the banner when the app is
// already foregrounded on that exact conversation.

export interface PushData {
  conversationId?: string
  kind?: 'approval' | 'turn'
}

function dataOf(notification: Notifications.Notification): PushData {
  return (notification.request.content.data ?? {}) as PushData
}

// --- (3) Foreground suppression ---------------------------------------------
// Mirror sw.js's `c=` focus check: when a push arrives while the app is active
// AND already focused on that conversation, swallow the banner — the open
// screen has its own live stream + haptics, so a banner would be noise. Every
// other case (backgrounded, or focused elsewhere) shows it normally.
export function configureNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const { conversationId } = dataOf(notification)
      const focusedHere =
        AppState.currentState === 'active' &&
        !!conversationId &&
        useStore.getState().currentId === conversationId
      const show = !focusedHere
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      }
    },
  })
}

// Project id only exists under an EAS build/config; in bare dev it's undefined
// and the OS can't mint a token. Read defensively.
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId
}

// --- (1) Registration --------------------------------------------------------
// Ask for OS permission, mint the Expo push token, and register it with the
// paired box (POST /push/subscribe → registry.addExpoPushToken). Best-effort
// and idempotent: every failure path resolves null and leaves the app fully
// usable (push is a bonus, never required). No-op when not yet paired — there's
// no box to register against.
export async function registerForPushAsync(): Promise<string | null> {
  if (!getStoredHost() || !getStoredToken()) return null
  try {
    const existing = await Notifications.getPermissionsAsync()
    let granted = existing.granted || existing.status === 'granted'
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync()
      granted = requested.granted || requested.status === 'granted'
    }
    if (!granted) return null
    const pid = projectId()
    const response = await Notifications.getExpoPushTokenAsync(pid ? { projectId: pid } : undefined)
    const token = response.data
    if (!token) return null
    await api.subscribeExpoPush(token)
    return token
  } catch {
    // permission denied at OS level, no projectId, network down — degrade quietly
    return null
  }
}

// --- (2) Deep-link on tap ----------------------------------------------------
// The native analogue of sw.js's `notificationclick → /?c=…`. `navigate` is
// injected so this module stays decoupled from expo-router (and is trivially
// testable). Returns an unsubscribe.
export function addNotificationResponseListener(
  navigate: (conversationId: string) => void,
): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    const { conversationId } = dataOf(response.notification)
    if (conversationId) navigate(conversationId)
  })
  return () => sub.remove()
}

// Cold start: the app may have been launched by tapping a notification while
// killed. Replay that last response once so we still deep-link. Best-effort.
export async function consumeInitialNotificationResponse(
  navigate: (conversationId: string) => void,
): Promise<void> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync()
    if (!response) return
    const { conversationId } = dataOf(response.notification)
    if (conversationId) navigate(conversationId)
  } catch {
    // best-effort
  }
}
