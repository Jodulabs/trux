import { useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import type { Conversation } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { theme, STATUS_COLORS } from '../../src/theme'
import { getStoredHost } from '../../src/ports'

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

function titleOf(c: Conversation): string {
  return c.title ?? shortCwd(c.cwd)
}

export default function ConversationListScreen(): React.ReactElement {
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const convMeta = useStore((s) => s.convMeta)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  }, [])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!searchQ.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(() => {
      void api.searchConversations(searchQ.trim()).then(setSearchResults).catch(() => setSearchResults(null))
    }, 250)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [searchQ])

  const displayList = searchResults ?? conversations

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
        <Pressable hitSlop={12} onPress={() => router.push('/settings')} style={styles.settingsBtn}>
          <Text style={styles.settingsBtnText}>⚙</Text>
        </Pressable>
        <Pressable hitSlop={12} onPress={() => router.push('/connections')} style={styles.connBtn}>
          <Text style={styles.settingsBtnText}>🔑</Text>
        </Pressable>
        <Pressable hitSlop={12} onPress={() => router.push('/new')} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+</Text>
        </Pressable>
      </View>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={searchQ}
          onChangeText={setSearchQ}
          placeholder="Search conversations…"
          placeholderTextColor={theme.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQ ? (
          <Pressable hitSlop={12} onPress={() => setSearchQ('')} style={styles.searchClear}>
            <Text style={styles.searchClearText}>✕</Text>
          </Pressable>
        ) : null}
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
        data={displayList}
        keyExtractor={(c) => c.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reload() }} tintColor={theme.accent} />
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item: c }) => {
          const meta = convMeta[c.id]
          const liveStatus = meta?.status ?? c.status
          const unread = meta?.unread ?? 0
          const cost = meta?.totalCost ?? 0
          return (
            <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => open(c.id)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{meta?.title ?? titleOf(c)}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{shortCwd(c.cwd)}</Text>
              </View>
              {cost > 0 ? <Text style={styles.costBadge}>${cost.toFixed(2)}</Text> : null}
              {unread > 0 ? <View style={styles.unreadBadge}><Text style={styles.unreadText}>{unread}</Text></View> : null}
              <Text style={styles.agentBadge}>{c.agent}</Text>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✳</Text>
            <Text style={styles.emptyTitle}>{searchQ ? 'No matches.' : 'What should we build?'}</Text>
            {!searchQ ? (
              <Pressable style={styles.emptyNewBtn} onPress={() => router.push('/new')}>
                <Text style={styles.emptyNewBtnText}>+ New conversation</Text>
              </Pressable>
            ) : null}
          </View>
        }
        contentContainerStyle={displayList.length === 0 ? styles.emptyList : undefined}
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
    alignItems: 'center',
    gap: 8,
  },
  mark: { color: theme.accent, fontSize: 18, fontFamily: theme.fontMono },
  title: { color: theme.text, fontSize: 20, fontFamily: `${theme.fontSans}-600` },
  host: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, marginLeft: 'auto', flexShrink: 1 },
  newBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: { color: theme.ink, fontSize: 20, fontFamily: `${theme.fontSans}-600` },
  settingsBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
  },
  settingsBtnText: { color: theme.textDim, fontSize: 18 },
  connBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 14,
    fontFamily: theme.fontSans,
  },
  searchClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: theme.textFaint, fontSize: 14 },
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
  costBadge: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono },
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
  empty: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  emptyList: { flex: 1, justifyContent: 'center' },
  emptyMark: { color: theme.accent, fontSize: 32, fontFamily: theme.fontMono },
  emptyTitle: { color: theme.text, fontSize: 18, fontFamily: `${theme.fontSans}-500` },
  emptyNewBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
  },
  emptyNewBtnText: { color: theme.ink, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
  errorBox: { margin: 20, padding: 16, backgroundColor: theme.surface1, borderRadius: theme.radius, gap: 12 },
  errorText: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  retryBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: theme.accent, borderRadius: theme.radiusSm },
  retryText: { color: theme.ink, fontFamily: `${theme.fontSans}-600` },
})
