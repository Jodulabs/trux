import { useEffect } from 'react'
import { Redirect, Stack } from 'expo-router'
import { useStore } from '@trux/client/store'
import { theme } from '../../src/theme'
import { getStoredHost, getStoredToken } from '../../src/ports'

// Authed shell: every screen under (app) requires a paired host + token. If
// either is missing, redirect to the pair flow. The check is a one-shot read
// of the hydrated Storage cache — configureNativeClient ran in the root layout
// before this mounted.
export default function AppLayout(): React.ReactElement {
  const host = getStoredHost()
  const token = getStoredToken()
  const loadConversations = useStore((s) => s.loadConversations)
  const loadRemoteConfig = useStore((s) => s.loadRemoteConfig)

  // Warm the shared store as soon as we're authed. Best-effort; a 401 surfaces
  // in the list screen's empty state and offers re-pairing.
  useEffect(() => {
    if (!host || !token) return
    void Promise.all([loadConversations(), loadRemoteConfig().catch(() => {})]).catch(() => {})
  }, [host, token, loadConversations, loadRemoteConfig])

  if (!host || !token) {
    return <Redirect href="/pair" />
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.ink },
        animation: 'slide_from_right',
      }}
    />
  )
}
