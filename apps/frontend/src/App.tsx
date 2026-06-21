import { useEffect, useState } from 'react'
import type { Conversation } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { subscribeToPush } from './push'
import { Rail } from './components/Rail'
import { ConversationList } from './components/ConversationList'
import { ConversationView } from './components/ConversationView'
import { NewConversationDialog } from './components/NewConversationDialog'
import { TokenGate } from './components/TokenGate'

// A push deep-link arrives as ?c=<id> (cold open) or a SW postMessage (warm tab).
function deepLinkConversationId(): string | null {
  try {
    return new URLSearchParams(location.search).get('c')
  } catch {
    return null
  }
}

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

// A conversation's display title: a live/stored title wins over the cwd basename.
function titleOf(c: Conversation): string {
  return c.title ?? shortCwd(c.cwd)
}

export function App(): React.ReactElement {
  const allConversations = useStore((s) => s.conversations)
  const serverCwd = useStore((s) => s.serverCwd)
  const conversations = serverCwd
    ? allConversations.filter((c) => c.cwd === serverCwd)
    : allConversations
  const currentId = useStore((s) => s.currentId)
  const loadConversations = useStore((s) => s.loadConversations)
  const loadRemoteConfig = useStore((s) => s.loadRemoteConfig)
  const selectConversation = useStore((s) => s.selectConversation)
  const [needsToken, setNeedsToken] = useState(false)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The conversation list is a slide-over toggled from the rail (desktop) or the
  // mobile hamburger. Collapsed by default on every screen.
  const [listOpen, setListOpen] = useState(false)

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
        else setLoadError(err instanceof Error ? err.message : String(err))
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

  if (loadError) {
    return (
      <div data-testid="load-error" style={{ padding: '2rem', color: '#f87171', fontFamily: 'monospace' }}>
        <p>Failed to connect: {loadError}</p>
        <button onClick={() => { setLoadError(null); tryLoad() }}>Retry</button>
      </div>
    )
  }

  if (!ready) return <div data-testid="loading" />

  const onCreated = async (id: string): Promise<void> => {
    await loadConversations()
    await selectConversation(id)
  }

  // Start a new conversation: clear the current one (show the greeting empty
  // state) and close the list. selectConversation('') short-circuits to empty.
  const onNew = (): void => {
    void selectConversation('')
    setListOpen(false)
    // Drop the stale deep-link so a reload shows the empty state, not the
    // previous conversation. Cleared here (not in an effect) to avoid racing
    // the initial deep-link consumption on mount.
    try {
      const url = new URL(location.href)
      if (url.searchParams.has('c')) {
        url.searchParams.delete('c')
        history.replaceState(null, '', url)
      }
    } catch {
      // URL/history unavailable (e.g. test env) — non-fatal
    }
  }

  // Selecting/creating dismisses the slide-over so the conversation is full-screen.
  const pick = (id: string): void => {
    void selectConversation(id)
    setListOpen(false)
  }

  const current = conversations.find((c) => c.id === currentId)
  const mobileTitle = current ? titleOf(current) : 'trux'

  return (
    <div className="app">
      <Rail onNew={onNew} onToggleList={() => setListOpen(true)} />
      {listOpen ? (
        <>
          <ConversationList
            conversations={conversations}
            currentId={currentId}
            onSelect={pick}
          />
          <div className="drawer-backdrop" data-testid="list-backdrop" onClick={() => setListOpen(false)} />
        </>
      ) : null}
      <main>
        <header className="mobile-bar">
          <button
            className="drawer-toggle"
            data-testid="drawer-toggle"
            aria-label="Open conversations"
            onClick={() => setListOpen(true)}
          >
            ☰
          </button>
          <span className="mobile-title">{mobileTitle}</span>
        </header>
        {currentId ? (
          <ConversationView key={currentId} id={currentId} />
        ) : (
          <div className="empty-state" data-testid="empty">
            <div className="greeting">
              <span className="greeting-mark">✳</span>
              <h1>What should we build?</h1>
            </div>
            <NewConversationDialog onCreated={(id) => void onCreated(id)} />
          </div>
        )}
      </main>
    </div>
  )
}
