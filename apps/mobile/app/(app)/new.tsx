import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import type { AgentCapabilities, AgentName, DiscoveredSession, Workspace } from '@trux/protocol'
import { api } from '@trux/client/api'
import { useStore } from '@trux/client/store'
import { theme } from '../../src/theme'
import { haptic } from '../../src/haptics'

function basename(path: string): string {
  const p = path.replace(/\/$/, '').split('/').pop()
  return p || path
}

interface FolderEntry {
  project: string
  root: string
  path: string
  branch: string | null
  multi: boolean
}

export default function NewConversationScreen(): React.ReactElement {
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const loadConversations = useStore((s) => s.loadConversations)
  const selectConversation = useStore((s) => s.selectConversation)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<AgentCapabilities[]>([])
  const [agent, setAgent] = useState<AgentName>('claude')
  const [cwd, setCwd] = useState('')
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState<DiscoveredSession[]>([])
  const [sessionId, setSessionId] = useState('')
  const [creating, setCreating] = useState(false)
  const [loadingFolders, setLoadingFolders] = useState(true)

  useEffect(() => {
    void Promise.all([
      api.listWorkspaces().then((w) => { setWorkspaces(w); setLoadingFolders(false) }),
      api.listAgents().then((r) => {
        const list = r.agents ?? []
        setAgents(list)
        if (list[0]) setAgent(list[0].agent)
      }),
    ]).catch(() => setLoadingFolders(false))
  }, [])

  const folders = useMemo<FolderEntry[]>(
    () =>
      workspaces.flatMap((w) =>
        w.worktrees.map((t) => ({
          project: w.name,
          root: w.root,
          path: t.path,
          branch: t.branch,
          multi: w.worktrees.length > 1,
        })),
      ),
    [workspaces],
  )

  const byPath = useMemo(() => new Map(folders.map((f) => [f.path, f])), [folders])

  const recents = useMemo<FolderEntry[]>(() => {
    const seen = new Set<string>()
    const out: FolderEntry[] = []
    for (const c of [...conversations].sort((a, b) => b.updated_at - a.updated_at)) {
      if (seen.has(c.cwd)) continue
      seen.add(c.cwd)
      out.push(byPath.get(c.cwd) ?? { project: basename(c.cwd), root: c.cwd, path: c.cwd, branch: null, multi: false })
      if (out.length >= 5) break
    }
    return out
  }, [conversations, byPath])

  useEffect(() => {
    if (cwd) return
    const first = recents[0]?.path ?? folders[0]?.path ?? ''
    if (first) setCwd(first)
  }, [recents, folders, cwd])

  useEffect(() => {
    if (!cwd || !agent) return
    setSessions([])
    setSessionId('')
    void api.discoverSessions(agent, cwd).then(setSessions).catch(() => setSessions([]))
  }, [agent, cwd])

  const q = query.trim().toLowerCase()
  const matches = (f: FolderEntry): boolean =>
    !q ||
    f.project.toLowerCase().includes(q) ||
    f.path.toLowerCase().includes(q) ||
    (f.branch?.toLowerCase().includes(q) ?? false)

  const filteredRecents = q ? recents.filter(matches) : recents

  type Row =
    | { kind: 'section'; key: string; title: string }
    | { kind: 'folder'; key: string; entry: FolderEntry; label: string }

  const rows: Row[] = []
  if (filteredRecents.length > 0) {
    rows.push({ kind: 'section', key: 'recent-section', title: 'Recent' })
    for (const f of filteredRecents) {
      // Single-worktree repos show just the project name; the branch suffix
      // (e.g. "· main") is redundant noise next to the path shown below it.
      rows.push({ kind: 'folder', key: `r-${f.path}`, entry: f, label: f.multi && f.branch ? `${f.project} · ${f.branch}` : f.project })
    }
  }
  const groups = useMemo(() => {
    const map = new Map<string, FolderEntry[]>()
    for (const f of folders) {
      if (!matches(f)) continue
      const arr = map.get(f.root) ?? []
      arr.push(f)
      map.set(f.root, arr)
    }
    return [...map.values()]
  }, [folders, q])
  if (groups.length > 0) {
    rows.push({ kind: 'section', key: 'projects-section', title: 'Projects' })
    for (const items of groups) {
      const head = items[0]
      if (!head.multi) {
        rows.push({ kind: 'folder', key: head.root, entry: head, label: head.project })
      } else {
        for (const f of items) {
          rows.push({ kind: 'folder', key: f.path, entry: f, label: f.branch ?? basename(f.path) })
        }
      }
    }
  }

  const create = async (): Promise<void> => {
    if (!cwd || creating) return
    setCreating(true)
    try {
      const conv = await api.createConversation({
        agent,
        cwd,
        native_session_id: sessionId || undefined,
        model: null,
        options: {},
      })
      await loadConversations()
      await selectConversation(conv.id)
      haptic('success')
      router.replace(`/session/${conv.id}`)
    } catch (err) {
      haptic('error')
      setCreating(false)
    }
  }

  const hasControls = agents.length > 1 || sessions.length > 0

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>New conversation</Text>
      </View>

      <TextInput
        style={styles.search}
        value={query}
        onChangeText={setQuery}
        placeholder="Search projects and folders…"
        placeholderTextColor={theme.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        style={styles.list}
        renderItem={({ item: r }) => {
          if (r.kind === 'section') {
            return <Text style={styles.sectionTitle}>{r.title}</Text>
          }
          const selected = cwd === r.entry.path
          return (
            <Pressable
              style={({ pressed }) => [styles.folderRow, selected && styles.folderRowSelected, pressed && !selected && styles.folderRowPressed]}
              onPress={() => { setCwd(r.entry.path); haptic('light') }}
            >
              <Text style={styles.folderLabel} numberOfLines={1}>{r.label}</Text>
              <Text style={styles.folderPath} numberOfLines={1}>{r.entry.path}</Text>
            </Pressable>
          )
        }}
        ListEmptyComponent={
          loadingFolders ? (
            <View style={styles.empty}><ActivityIndicator color={theme.accent} /></View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{q ? 'No matching folders.' : 'No projects configured.'}</Text>
            </View>
          )
        }
      />

      {hasControls ? (
        <View style={styles.controlsBar}>
          {agents.length > 1 ? (
            <View style={styles.pickerWrap}>
              <Text style={styles.pickerLabel}>Agent</Text>
              <View style={styles.pickerRow}>
                {agents.map((a) => (
                  <Pressable
                    key={a.agent}
                    style={[styles.pickerChip, agent === a.agent && styles.pickerChipSelected]}
                    onPress={() => setAgent(a.agent)}
                  >
                    <Text style={[styles.pickerChipText, agent === a.agent && styles.pickerChipTextSelected]}>{a.agent}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {sessions.length > 0 ? (
            <View style={styles.pickerWrap}>
              <Text style={styles.pickerLabel}>Resume session</Text>
              <View style={styles.pickerRow}>
                <Pressable
                  style={[styles.pickerChip, !sessionId && styles.pickerChipSelected]}
                  onPress={() => setSessionId('')}
                >
                  <Text style={[styles.pickerChipText, !sessionId && styles.pickerChipTextSelected]}>New</Text>
                </Pressable>
                {sessions.slice(0, 3).map((s) => (
                  <Pressable
                    key={s.sessionId}
                    style={[styles.pickerChip, sessionId === s.sessionId && styles.pickerChipSelected]}
                    onPress={() => setSessionId(s.sessionId)}
                  >
                    <Text style={[styles.pickerChipText, sessionId === s.sessionId && styles.pickerChipTextSelected]} numberOfLines={1}>
                      {s.sessionId.slice(0, 8)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.createBtn, (!cwd || creating) && styles.createBtnDisabled, pressed && cwd && !creating && styles.createBtnPressed]}
          disabled={!cwd || creating}
          onPress={() => void create()}
        >
          {creating ? (
            <ActivityIndicator color={theme.ink} size="small" />
          ) : (
            <Text style={styles.createBtnText}>+ New conversation</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  search: {
    margin: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontSans,
  },
  list: { flex: 1, paddingHorizontal: 12 },
  sectionTitle: {
    color: theme.textFaint,
    fontSize: 12,
    fontFamily: theme.fontMono,
    textTransform: 'uppercase',
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  folderRow: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: theme.radiusSm,
    gap: 2,
  },
  folderRowSelected: {
    backgroundColor: theme.accentSoft,
    borderWidth: 1,
    borderColor: theme.accent,
  },
  folderRowPressed: { backgroundColor: theme.surface1 },
  folderLabel: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans },
  folderPath: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyText: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
  controlsBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.lineSoft,
    gap: 10,
  },
  pickerWrap: { gap: 6 },
  pickerLabel: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface1,
  },
  pickerChipSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
  pickerChipText: { color: theme.text, fontSize: 13, fontFamily: theme.fontSans },
  pickerChipTextSelected: { color: theme.ink, fontWeight: '600' },
  footer: { paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 20 },
  createBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  createBtnPressed: { backgroundColor: theme.accentBright },
  createBtnDisabled: { backgroundColor: theme.surface3 },
  createBtnText: { color: theme.ink, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
})
