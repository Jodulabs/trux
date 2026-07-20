import { useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import type { Conversation } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { theme, STATUS_COLORS } from '../../theme'
import { getStoredHost } from '../../ports'

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

function titleOf(c: Conversation): string {
  return c.title ?? shortCwd(c.cwd)
}

export function Sidebar(): React.ReactElement {
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const convMeta = useStore((s) => s.convMeta)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [loading, setLoading] = useState(true)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const host = getStoredHost()

  useEffect(() => {
    void loadConversations()
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [loadConversations])

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

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <Text style={styles.mark}>✳</Text>
        <Text style={styles.title}>trux</Text>
        {host ? <Text style={styles.host} numberOfLines={1}>{host}</Text> : null}
        <Pressable hitSlop={12} onPress={() => router.push('/new')} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+</Text>
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={searchQ}
          onChangeText={setSearchQ}
          placeholder="Search…"
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

      {loading && conversations.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="small" />
        </View>
      ) : (
        <FlatList
          data={displayList}
          keyExtractor={(c) => c.id}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item: c }) => {
            const meta = convMeta[c.id]
            const liveStatus = meta?.status ?? c.status
            const unread = meta?.unread ?? 0
            const cost = meta?.totalCost ?? 0
            return (
              <Pressable
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => open(c.id)}
              >
                <View style={[styles.dot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{meta?.title ?? titleOf(c)}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{shortCwd(c.cwd)}</Text>
                </View>
                {cost > 0 ? <Text style={styles.costBadge}>${cost.toFixed(2)}</Text> : null}
                {unread > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{unread}</Text>
                  </View>
                ) : null}
                <Text style={styles.agentBadge}>{c.agent}</Text>
              </Pressable>
            )
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{searchQ ? 'No matches.' : 'No conversations yet.'}</Text>
            </View>
          }
          contentContainerStyle={displayList.length === 0 ? styles.emptyList : undefined}
        />
      )}

      <View style={styles.footer}>
        <Pressable style={styles.footerBtn} onPress={() => router.push('/settings')}>
          <Text style={styles.footerBtnText}>⚙ Settings</Text>
        </Pressable>
        <Pressable style={styles.footerBtn} onPress={() => router.push('/connections')}>
          <Text style={styles.footerBtnText}>🔑 Hosts</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    width: 280,
    backgroundColor: theme.ink,
    borderRightWidth: 1,
    borderRightColor: theme.lineSoft,
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  mark: { color: theme.accent, fontSize: 16, fontFamily: theme.fontMono },
  title: { color: theme.text, fontSize: 18, fontFamily: `${theme.fontSans}-600` },
  host: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, marginLeft: 'auto', flexShrink: 1 },
  newBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: { color: theme.ink, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  searchInput: {
    flex: 1,
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: theme.text,
    fontSize: 13,
    fontFamily: theme.fontSans,
  },
  searchClear: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  searchClearText: { color: theme.textFaint, fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    minHeight: 48,
  },
  rowPressed: { backgroundColor: theme.surface1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { color: theme.text, fontSize: 13, fontFamily: theme.fontSans },
  rowSub: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono },
  costBadge: { color: theme.textFaint, fontSize: 10, fontFamily: theme.fontMono },
  unreadBadge: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
  },
  unreadText: { color: theme.ink, fontSize: 10, fontFamily: `${theme.fontSans}-600` },
  agentBadge: {
    color: theme.textDim,
    fontSize: 9,
    fontFamily: theme.fontMono,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  sep: { height: 1, backgroundColor: theme.lineSoft, marginLeft: 30 },
  empty: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontSans },
  emptyList: { flex: 1, justifyContent: 'center' },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.lineSoft,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  footerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: theme.radiusSm,
  },
  footerBtnText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontSans },
})
