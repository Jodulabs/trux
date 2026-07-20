import { useEffect, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import type { Conversation, Project } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { theme, STATUS_COLORS } from '../../src/theme'
import { getStoredHost } from '../../src/ports'
import { IconButton } from '../../src/icons'

export default function ProjectsScreen(): React.ReactElement {
  const router = useRouter()
  const projects = useStore((s) => s.projects)
  const conversations = useStore((s) => s.conversations)
  const convMeta = useStore((s) => s.convMeta)
  const loadProjects = useStore((s) => s.loadProjects)
  const loadConversations = useStore((s) => s.loadConversations)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const host = getStoredHost()

  const reload = async (): Promise<void> => {
    try {
      await Promise.all([loadProjects(), loadConversations()])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void reload()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const chatsByProject = new Map<string, Conversation[]>()
  for (const c of conversations) {
    if (!c.project_id) continue
    const arr = chatsByProject.get(c.project_id) ?? []
    arr.push(c)
    chatsByProject.set(c.project_id, arr)
  }

  const open = (p: Project): void => {
    void router.push(`/projects/${p.id}`)
  }

  if (loading && projects.length === 0) {
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
        <Text style={styles.mark} accessibilityLabel="trux">✳</Text>
        <Text style={styles.title}>trux</Text>
        {host ? <Text style={styles.host} numberOfLines={1}>{host}</Text> : null}
        <IconButton name="key-outline" accessibilityLabel="Providers" onPress={() => router.push('/providers')} />
        <IconButton name="settings-outline" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
        <IconButton
          name="add"
          accessibilityLabel="New project"
          onPress={() => router.push('/new-project')}
          color={theme.ink}
          style={styles.newBtn}
        />
      </View>

      <FlatList
        data={projects}
        keyExtractor={(p) => p.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void reload() }} tintColor={theme.accent} />
        }
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item: p }) => {
          const chats = chatsByProject.get(p.id) ?? []
          const providerChips = Array.from(new Set(chats.map((c) => c.agent)))
          const anyApproval = chats.some((c) => {
            const s = convMeta[c.id]?.status ?? c.status
            return s === 'awaiting_approval'
          })
          const anyActive = chats.some((c) => {
            const s = convMeta[c.id]?.status ?? c.status
            return s === 'thinking' || s === 'awaiting_approval'
          })
          const statusColor = anyApproval ? STATUS_COLORS.awaiting_approval : anyActive ? STATUS_COLORS.thinking : STATUS_COLORS.idle
          const statusLabel = anyApproval ? 'Needs approval' : anyActive ? 'Working' : 'Idle'
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => open(p)}
              accessibilityRole="button"
              accessibilityLabel={`Project ${p.name}, ${chats.length} chats, ${statusLabel}`}
            >
              <View style={styles.cardHead}>
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={styles.cardName} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.chatCount}>{chats.length}</Text>
              </View>
              <Text style={styles.cardPath} numberOfLines={1}>{p.cwd}</Text>
              {providerChips.length > 0 ? (
                <View style={styles.chipRow}>
                  {providerChips.map((a) => (
                    <View key={a} style={styles.agentChip}>
                      <Text style={styles.agentChipText}>{a}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Pressable>
          )
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyMark}>✳</Text>
            <Text style={styles.emptyTitle}>What should we build?</Text>
            <Text style={styles.emptySub}>Create a project to group your chats by codebase.</Text>
            <Pressable
              style={styles.emptyNewBtn}
              onPress={() => router.push('/new-project')}
              accessibilityRole="button"
              accessibilityLabel="New project"
            >
              <Text style={styles.emptyNewBtnText}>+ New project</Text>
            </Pressable>
          </View>
        }
        contentContainerStyle={projects.length === 0 ? styles.emptyList : undefined}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  centering: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  mark: { color: theme.accent, fontSize: 18, fontFamily: theme.fontMono, paddingHorizontal: 8 },
  title: { color: theme.text, fontSize: 20, fontFamily: `${theme.fontSans}-600` },
  host: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, marginLeft: 'auto', flexShrink: 1 },
  newBtn: { backgroundColor: theme.accent, borderRadius: 22 },
  sep: { height: 1, backgroundColor: theme.lineSoft, marginHorizontal: 16 },
  card: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 8,
    minHeight: 64,
  },
  cardPressed: { backgroundColor: theme.surface1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  cardName: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500`, flex: 1, minWidth: 0 },
  chatCount: {
    color: theme.textFaint,
    fontSize: 12,
    fontFamily: theme.fontMono,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    textAlign: 'center',
  },
  cardPath: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  agentChip: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  agentChipText: { color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 20 },
  emptyList: { flex: 1, justifyContent: 'center' },
  emptyMark: { color: theme.accent, fontSize: 32, fontFamily: theme.fontMono },
  emptyTitle: { color: theme.text, fontSize: 18, fontFamily: `${theme.fontSans}-500` },
  emptySub: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans, textAlign: 'center', paddingHorizontal: 20 },
  emptyNewBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginTop: 8,
    minHeight: 48,
  },
  emptyNewBtnText: { color: theme.ink, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
})
