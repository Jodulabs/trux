import { useEffect } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ConversationView } from './components/ConversationView'

export function App(): React.ReactElement {
  const conversations = useStore((s) => s.conversations)
  const currentId = useStore((s) => s.currentId)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)

  useEffect(() => {
    void loadConversations()
  }, [loadConversations])

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
