import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Conversation, Project } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { theme, STATUS_COLORS } from '../../../src/theme'

function titleOf(c: Conversation): string {
  return c.title ?? 'Untitled'
}

// Project detail: chats in this project, grouped under the project's cwd. Each
// row shows status dot, title, agent·model chip, last-updated time, unread/approval
// badge. Tap → session. FAB → new chat in this project (cwd inherited).
export default function ProjectDetailScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const convMeta = useStore((s) => s.convMeta)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      await Promise.all([
        api.getProject(id).then((r) => setProject(r.project)).catch(() => setProject(null)),
        loadConversations(),
      ])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { void reload() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const chats = conversations.filter((c) => c.project_id === id)

  const open = (cid: string): void => {
    void selectConversation(cid).then(() => router.push(`/session/${cid}`))
  }

  if (loading && !project) {
    return (
      <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
        <View style={styles.centering}>
          <ActivityIndicator color={theme.accent} size="large" />
        </View>
      </SafeAreaView>
    )
  }

  if (!project) {
    return (
      <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
        <View style={styles.centering}>
          <Text style={styles.emptyText}>Project not found.</Text>
          <Pressable style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backBtnText}>‹ Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={styles.barText}>
          <Text style={styles.title} numberOfLines={1}>{project.name}</Text>
          <Text style={styles.path} numberOfLines={1}>{project.cwd}</Text>
        </View>
        <Pressable hitSlop={12} onPress={() => router.push(`/new?projectId=${project.id}`)} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+</Text>
        </Pressable>
      </View>

      <FlatList
        data={chats}
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
          const modelLabel = c.model ?? 'default'
          return (
            <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]} onPress={() => open(c.id)}>
              <View style={[styles.dot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1}>{meta?.title ?? titleOf(c)}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{c.agent} · {modelLabel}</Text>
              </View>
              {cost > 0 ? <Text style={styles.costBadge}>${cost.toFixed(2)}</Text> : null}
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
            <Text style={styles.emptyText}>No chats in this project yet.</Text>
            <Pressable style={styles.emptyNewBtn} onPress={() => router.push(`/new?projectId=${project.id}`)}>
              <Text style={styles.emptyNewBtnText}>+ New chat</Text>
            </Pressable>
          </View>
        }
        contentContainerStyle={chats.length === 0 ? styles.emptyList : undefined}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  centering: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
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
  barText: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  path: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono },
  newBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newBtnText: { color: theme.ink, fontSize: 20, fontFamily: `${theme.fontSans}-600` },
  sep: { height: 1, backgroundColor: theme.lineSoft, marginLeft: 40 },
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
  empty: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  emptyList: { flex: 1, justifyContent: 'center' },
  emptyText: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
  backBtn: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: theme.surface2, borderRadius: theme.radiusSm },
  backBtnText: { color: theme.accent, fontFamily: `${theme.fontSans}-600` },
  emptyNewBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
  },
  emptyNewBtnText: { color: theme.ink, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
})
