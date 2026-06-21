import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { GitStatusResult } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { theme } from '../../../src/theme'
import { ConversationView } from '../../../src/components/ConversationView'
import { GitPanel } from '../../../src/components/GitPanel'

// Phase A4 session screen: a back button + the loaded conversation title, then
// the ConversationView (transcript + composer + connection banner). The view
// owns its WS connection via the shared connectionManager. A git badge (Phase
// C3) opens the GitPanel for review/commit when the conversation is a repo.
export default function SessionScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const conv = conversations.find((c) => c.id === id)
  const title = conv?.title ?? conv?.cwd?.replace(/\/$/, '').split('/').pop() ?? id

  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitOpen, setGitOpen] = useState(false)

  const loadGit = (): void => {
    void api.gitStatus(id).then(setGitStatus).catch(() => setGitStatus(null))
  }
  useEffect(() => { loadGit() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const repo = gitStatus?.repo ? gitStatus : null

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {repo ? (
          <Pressable
            style={[styles.gitBadge, repo.dirty && styles.gitBadgeDirty]}
            onPress={() => setGitOpen(true)}
            accessibilityLabel="Open git panel"
            hitSlop={8}
          >
            <Text style={styles.gitBadgeText} numberOfLines={1}>
              {repo.branch ?? 'HEAD'}{repo.dirty ? ' ●' : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ConversationView id={id} onBack={() => router.back()} />
      <GitPanel
        conversationId={id}
        visible={gitOpen}
        onClose={() => { setGitOpen(false); loadGit() }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500`, flex: 1 },
  gitBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
    maxWidth: 140,
  },
  gitBadgeDirty: { borderColor: theme.accent },
  gitBadgeText: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono },
})
