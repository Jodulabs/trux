import { useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native'
import { useRouter } from 'expo-router'
import type { Conversation, Project } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { theme, STATUS_COLORS } from '../../theme'
import { getStoredHost } from '../../ports'
import { IconButton } from '../../icons'

function shortCwd(cwd: string): string {
  const parts = cwd.replace(/\/$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

function titleOf(c: Conversation): string {
  return c.title ?? shortCwd(c.cwd)
}

type ListItem =
  | { kind: 'project'; project: Project }
  | { kind: 'chat'; conversation: Conversation }

export function Sidebar(): React.ReactElement {
  const router = useRouter()
  const projects = useStore((s) => s.projects)
  const conversations = useStore((s) => s.conversations)
  const convMeta = useStore((s) => s.convMeta)
  const loadProjects = useStore((s) => s.loadProjects)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [loading, setLoading] = useState(true)
  const [searchQ, setSearchQ] = useState('')
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const host = getStoredHost()

  useEffect(() => {
    void Promise.all([loadProjects(), loadConversations()])
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [loadProjects, loadConversations])

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!searchQ.trim()) { setSearchResults(null); return }
    searchTimer.current = setTimeout(() => {
      void api.searchConversations(searchQ.trim()).then(setSearchResults).catch(() => setSearchResults(null))
    }, 250)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [searchQ])

  const chatsByProject = new Map<string, Conversation[]>()
  for (const c of conversations) {
    if (!c.project_id) continue
    const arr = chatsByProject.get(c.project_id) ?? []
    arr.push(c)
    chatsByProject.set(c.project_id, arr)
  }

  const openChat = (id: string): void => {
    void selectConversation(id).then(() => router.push(`/session/${id}`))
  }

  const toggleProject = (id: string): void => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const projectItems: ListItem[] = projects.flatMap((p) => {
    const open = expanded[p.id] ?? false
    const chats = chatsByProject.get(p.id) ?? []
    const head: ListItem = { kind: 'project', project: p }
    if (!open) return [head]
    return [head, ...chats.map((c) => ({ kind: 'chat' as const, conversation: c }))]
  })

  const searchItems: ListItem[] = (searchResults ?? []).map((c) => ({ kind: 'chat', conversation: c }))
  const displayList = searchQ.trim() ? searchItems : projectItems

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <Text style={styles.mark}>✳</Text>
        <Text style={styles.title}>trux</Text>
        {host ? <Text style={styles.host} numberOfLines={1}>{host}</Text> : null}
        <IconButton
          name="add"
          accessibilityLabel="New project"
          onPress={() => router.push('/new-project')}
          color={theme.ink}
          style={styles.newBtn}
        />
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          value={searchQ}
          onChangeText={setSearchQ}
          placeholder="Search chats…"
          placeholderTextColor={theme.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search chats"
        />
        {searchQ ? (
          <IconButton name="close" accessibilityLabel="Clear search" onPress={() => setSearchQ('')} size={16} />
        ) : null}
      </View>

      {loading && projects.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} size="small" />
        </View>
      ) : (
        <FlatList
          data={displayList}
          keyExtractor={(item) => item.kind === 'project' ? `p-${item.project.id}` : `c-${item.conversation.id}`}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          renderItem={({ item }) => {
            if (item.kind === 'project') {
              const p = item.project
              const chats = chatsByProject.get(p.id) ?? []
              const anyApproval = chats.some((c) => {
                const s = convMeta[c.id]?.status ?? c.status
                return s === 'awaiting_approval'
              })
              const anyActive = chats.some((c) => {
                const s = convMeta[c.id]?.status ?? c.status
                return s === 'thinking' || s === 'awaiting_approval'
              })
              const statusColor = anyApproval
                ? STATUS_COLORS.awaiting_approval
                : anyActive ? STATUS_COLORS.thinking : STATUS_COLORS.idle
              const open = expanded[p.id] ?? false
              return (
                <Pressable
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  onPress={() => toggleProject(p.id)}
                  onLongPress={() => router.push(`/projects/${p.id}`)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`Project ${p.name}, ${chats.length} chats`}
                >
                  <View style={[styles.dot, { backgroundColor: statusColor }]} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle} numberOfLines={1}>{p.name}</Text>
                    <Text style={styles.rowSub} numberOfLines={1}>{p.cwd}</Text>
                  </View>
                  <Text style={styles.count}>{chats.length}</Text>
                  <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
                </Pressable>
              )
            }
            const c = item.conversation
            const meta = convMeta[c.id]
            const liveStatus = meta?.status ?? c.status
            const unread = meta?.unread ?? 0
            return (
              <Pressable
                style={({ pressed }) => [styles.chatRow, pressed && styles.rowPressed]}
                onPress={() => openChat(c.id)}
                accessibilityRole="button"
                accessibilityLabel={`Chat ${meta?.title ?? titleOf(c)}`}
              >
                <View style={[styles.dot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
                <View style={styles.rowText}>
                  <Text style={styles.chatTitle} numberOfLines={1}>{meta?.title ?? titleOf(c)}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>{c.agent} · {c.model ?? 'default'}</Text>
                </View>
                {unread > 0 ? (
                  <View style={styles.unreadBadge}>
                    <Text style={styles.unreadText}>{unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            )
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{searchQ ? 'No matches.' : 'No projects yet.'}</Text>
            </View>
          }
          contentContainerStyle={displayList.length === 0 ? styles.emptyList : undefined}
        />
      )}

      <View style={styles.footer}>
        <Pressable
          style={styles.footerBtn}
          onPress={() => router.push('/settings')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Text style={styles.footerBtnText}>Settings</Text>
        </Pressable>
        <Pressable
          style={styles.footerBtn}
          onPress={() => router.push('/providers')}
          accessibilityRole="button"
          accessibilityLabel="Providers"
        >
          <Text style={styles.footerBtnText}>Providers</Text>
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
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  mark: { color: theme.accent, fontSize: 16, fontFamily: theme.fontMono },
  title: { color: theme.text, fontSize: 18, fontFamily: `${theme.fontSans}-600` },
  host: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, marginLeft: 'auto', flexShrink: 1 },
  newBtn: { backgroundColor: theme.accent, borderRadius: 22 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 2,
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
    paddingVertical: 8,
    color: theme.text,
    fontSize: 13,
    fontFamily: theme.fontSans,
    minHeight: 40,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    minHeight: 48,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingLeft: 28,
    paddingVertical: 8,
    gap: 8,
    minHeight: 44,
  },
  rowPressed: { backgroundColor: theme.surface1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  rowText: { flex: 1, gap: 1, minWidth: 0 },
  rowTitle: { color: theme.text, fontSize: 13, fontFamily: `${theme.fontSans}-500` },
  chatTitle: { color: theme.text, fontSize: 12, fontFamily: theme.fontSans },
  rowSub: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono },
  count: {
    color: theme.textFaint,
    fontSize: 11,
    fontFamily: theme.fontMono,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 8,
    minWidth: 18,
    paddingHorizontal: 5,
    textAlign: 'center',
  },
  chevron: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, width: 12 },
  unreadBadge: {
    backgroundColor: theme.accent,
    borderRadius: 8,
    minWidth: 16,
    paddingHorizontal: 4,
    paddingVertical: 1,
    alignItems: 'center',
  },
  unreadText: { color: theme.ink, fontSize: 10, fontFamily: `${theme.fontSans}-600` },
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
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: theme.radiusSm,
    justifyContent: 'center',
  },
  footerBtnText: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans },
})
