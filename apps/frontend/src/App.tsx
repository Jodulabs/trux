import { useEffect, useState } from 'react'
import { useStore } from './store'
import { api } from './api'
import { subscribeToPush } from './push'
import { Sidebar } from './components/Sidebar'
import { ConversationView } from './components/ConversationView'
import { TokenGate } from './components/TokenGate'
import { QuickSwitcher } from './components/QuickSwitcher'

// A push deep-link arrives as ?c=<id> (cold open) or a SW postMessage (warm tab).
function deepLinkConversationId(): string | null {
  try {
    return new URLSearchParams(location.search).get('c')
  } catch {
    return null
  }
}

export function App(): React.ReactElement {
  const conversations = useStore((s) => s.conversations)
  const currentId = useStore((s) => s.currentId)
  const loadConversations = useStore((s) => s.loadConversations)
  const loadRemoteConfig = useStore((s) => s.loadRemoteConfig)
  const selectConversation = useStore((s) => s.selectConversation)
  const [needsToken, setNeedsToken] = useState(false)
  const [ready, setReady] = useState(false)

  const tryLoad = (): void => {
    void Promise.all([
      loadConversations(),
      loadRemoteConfig().catch(() => { /* best-effort */ }),
    ])
      .then(() => {
        setReady(true)
        // Cold open from a notification: select the deep-linked conversation.
        const deep = deepLinkConversationId()
        if (deep) void selectConversation(deep).catch(() => {})
        // Register this device for push (no-op if push/VAPID unavailable).
        const vapid = useStore.getState().vapidPublicKey
        void subscribeToPush(vapid, (sub) => api.subscribePush(sub).then(() => {}))
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.startsWith('401')) setNeedsToken(true)
      })
  }

  useEffect(() => {
    tryLoad()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations])

  // Keep ?c=<id> in the URL in sync with the open conversation, so the SW can tell
  // whether a push's conversation is already foregrounded (and suppress the banner).
  useEffect(() => {
    if (!currentId) return
    try {
      const url = new URL(location.href)
      if (url.searchParams.get('c') !== currentId) {
        url.searchParams.set('c', currentId)
        history.replaceState(null, '', url)
      }
    } catch {
      // URL/history unavailable (e.g. test env) — non-fatal
    }
  }, [currentId])

  // Warm tab: the SW posts a navigate message when a notification is tapped.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent): void => {
      const data = e.data as { type?: string; conversationId?: string } | undefined
      if (data?.type === 'trux:navigate' && data.conversationId) {
        void selectConversation(data.conversationId).catch(() => {})
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [selectConversation])

  if (needsToken) {
    return <TokenGate onSaved={() => { setNeedsToken(false); tryLoad() }} />
  }

  if (!ready) return <div data-testid="loading" />

  const onCreated = async (id: string): Promise<void> => {
    await loadConversations()
    await selectConversation(id)
  }

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={(id) => void selectConversation(id)}
        onCreated={(id) => void onCreated(id)}
      />
      <main>
        {currentId ? (
          <ConversationView key={currentId} id={currentId} />
        ) : (
          <p data-testid="empty">Select or create a conversation.</p>
        )}
        <QuickSwitcher
          conversations={conversations}
          currentId={currentId}
          onSelect={(id) => void selectConversation(id)}
        />
      </main>
    </div>
  )
}
