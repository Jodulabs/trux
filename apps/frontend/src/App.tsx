import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ConversationView } from './components/ConversationView'
import { TokenGate } from './components/TokenGate'

export function App(): React.ReactElement {
  const conversations = useStore((s) => s.conversations)
  const currentId = useStore((s) => s.currentId)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [needsToken, setNeedsToken] = useState(false)
  const [ready, setReady] = useState(false)

  const tryLoad = (): void => {
    void loadConversations()
      .then(() => setReady(true))
      .catch((err: unknown) => {
        if (err instanceof Error && err.message.startsWith('401')) setNeedsToken(true)
      })
  }

  useEffect(() => {
    tryLoad()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadConversations])

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
      </main>
    </div>
  )
}
