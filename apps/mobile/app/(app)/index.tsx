import { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import type { Conversation } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { theme, STATUS_COLORS } from '../../src/theme'
import { getStoredHost } from '../../src/ports'

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

function titleOf(c: Conversation): string {
  return c.title ?? shortCwd(c.cwd)
}

// Phase A2 conversation list: proves the shared spine (api + store) reaches the
// paired host on native. A4 fleshes out the full conversation surface.
export default function ConversationListScreen(): React.ReactElement {
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const convMeta = useStore((s) => s.convMeta)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const host = getStoredHost()

  const reload = async (): Promise<void> => {
    try {
      await loadConversations()
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void reload()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const open = (id: string): void => {
    void selectConversation(id).then(() => router.push(`/session/${id}`))
  }

  if (loading && conversations.length === 0) {
    return (
      <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
        <View style={styles.centering}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.mark}>✳</Text>
        <Text style={styles.title}>trux</Text>
        {host ? <Text style={styles.host} numberOfLines={1}>{host}</Text> : null}
      </View>
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>Couldn't reach {host ?? 'host'}: {error}</Text>
          <Pressable style={styles.retryBtn} onPress={() => { setLoading(true); void reload() }}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reload() }} tintColor={theme.accent} />
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item: c }) => {
          const meta = convMeta[c.id]
          const liveStatus = meta?.status ?? c.status
          const unread = meta?.unread ?? 0
          return (
            <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => open(c.id)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{meta?.title ?? titleOf(c)}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{shortCwd(c.cwd)}</Text>
              </View>
              {unread > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unread}</Text></View> : null}
              <Text style={styles.agentBadge}>{c.agent}</Text>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✳</Text>
            <Text style={styles.emptyTitle}>What should we build?</Text>
          </View>
        }
        contentContainerStyle={conversations.length === 0 ? styles.emptyList : undefined}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  centering: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  mark: { color: theme.accent, fontSize: 18, fontFamily: theme.fontMono },
  title: { color: theme.text, fontSize: 20, fontFamily: `${theme.fontSans}-600` },
  host: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, marginLeft: 'auto', flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    minHeight: 56,
  },
  rowPressed: { backgroundColor: theme.surface1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans },
  rowSub: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono },
  unreadBadge: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  unreadText: { color: theme.ink, fontSize: 11, fontFamily: `${theme.fontSans}-600` },
  agentBadge: {
    color: theme.textDim,
    fontSize: 11,
    fontFamily: theme.fontMono,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  sep: { height: 1, backgroundColor: theme.lineSoft, marginLeft: 40 },
  empty: { alignItems: 'center', gap: 12 },
  emptyList: { flex: 1, justifyContent: 'center' },
  emptyMark: { color: theme.accent, fontSize: 32, fontFamily: theme.fontMono },
  emptyTitle: { color: theme.text, fontSize: 18, fontFamily: `${theme.fontSans}-500` },
  errorBox: { margin: 20, padding: 16, backgroundColor: theme.surface1, borderRadius: theme.radius, gap: 12 },
  errorText: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  retryBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.accent, borderRadius: theme.radiusSm },
  retryText: { color: theme.ink, fontFamily: `${theme.fontSans}-600` },
})
