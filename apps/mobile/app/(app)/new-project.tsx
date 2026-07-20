import { useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import type { AgentCatalogEntry, AgentName, Workspace } from '@trux/protocol'
import { api } from '@trux/client/api'
import { useStore } from '@trux/client/store'
import { theme } from '../../src/theme'
import { haptic } from '../../src/haptics'

function basename(path: string): string {
  const p = path.replace(/\/$/, '').split('/').pop()
  return p || path
}

interface PathEntry {
  label: string
  path: string
  branch: string | null
  source: 'workspace' | 'recent'
}

// New project flow: smart path search + name + default provider. The path
// picker searches workspace roots and recently-used cwds (recent first); a
// "paste manually" toggle lets the user type an arbitrary path. Creating a
// project persists it and routes to the project detail.
export default function NewProjectScreen(): React.ReactElement {
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const loadProjects = useStore((s) => s.loadProjects)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([])
  const [query, setQuery] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [manualPath, setManualPath] = useState('')
  const [name, setName] = useState('')
  const [defaultAgent, setDefaultAgent] = useState<AgentName | ''>('')
  const [cwd, setCwd] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void Promise.all([
      api.listWorkspaces().then((w) => { setWorkspaces(w); setLoading(false) }),
      api.getCatalog().then((r) => {
        const list = r.catalog ?? []
        setCatalog(list)
        const first = list.find((e) => e.runnable) ?? list[0]
        if (first) setDefaultAgent(first.agent)
      }),
    ]).catch(() => setLoading(false))
  }, [])

  const entries = useMemo<PathEntry[]>(() => {
    const recent: PathEntry[] = []
    const seen = new Set<string>()
    for (const c of [...conversations].sort((a, b) => b.updated_at - a.updated_at)) {
      if (seen.has(c.cwd)) continue
      seen.add(c.cwd)
      recent.push({ label: basename(c.cwd), path: c.cwd, branch: null, source: 'recent' })
      if (recent.length >= 5) break
    }
    const ws: PathEntry[] = workspaces.flatMap((w) =>
      w.worktrees.map((t) => ({
        label: w.worktrees.length > 1 && t.branch ? `${w.name} · ${t.branch}` : w.name,
        path: t.path,
        branch: t.branch,
        source: 'workspace' as const,
      })),
    )
    // Recents first, then workspaces, dedup by path.
    const merged = [...recent, ...ws.filter((w) => !seen.has(w.path))]
    return merged
  }, [conversations, workspaces])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false),
    )
  }, [entries, query])

  // When a path is selected, default the name to its basename if the user hasn't typed one.
  useEffect(() => {
    if (cwd && !name) setName(basename(cwd))
  }, [cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = (e: PathEntry): void => {
    setCwd(e.path)
    setQuery(e.label)
    haptic('light')
  }

  const create = async (): Promise<void> => {
    const finalCwd = manualMode ? manualPath.trim() : cwd
    if (!finalCwd) { setError('Pick or paste a path.'); return }
    if (!name.trim()) { setError('Name is required.'); return }
    setCreating(true); setError(null)
    try {
      const p = await api.createProject({
        name: name.trim(),
        cwd: finalCwd,
        default_agent: defaultAgent || null,
      })
      await loadProjects()
      haptic('success')
      router.replace(`/projects/${p.id}`)
    } catch (err) {
      haptic('error')
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  const runnableCatalog = catalog.filter((e) => e.runnable)

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>New project</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. trux"
          placeholderTextColor={theme.textFaint}
        />

        <View style={styles.pathHeader}>
          <Text style={styles.label}>Path</Text>
          <Pressable hitSlop={8} onPress={() => { setManualMode(!manualMode); setCwd(''); setManualPath('') }}>
            <Text style={styles.toggleText}>{manualMode ? 'pick from list' : 'paste manually'}</Text>
          </Pressable>
        </View>
        {manualMode ? (
          <TextInput
            style={[styles.input, { fontFamily: theme.fontMono }]}
            value={manualPath}
            onChangeText={setManualPath}
            placeholder="/absolute/path/to/codebase"
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : (
          <>
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Search projects and paths…"
              placeholderTextColor={theme.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {cwd ? (
              <View style={styles.selectedPath}>
                <Text style={styles.selectedPathLabel}>Selected:</Text>
                <Text style={styles.selectedPathValue} numberOfLines={1}>{cwd}</Text>
              </View>
            ) : null}
            <FlatList
              data={filtered}
              keyExtractor={(e) => e.path}
              style={styles.list}
              renderItem={({ item: e }) => (
                <Pressable
                  style={({ pressed }) => [styles.row, cwd === e.path && styles.rowSelected, pressed && cwd !== e.path && styles.rowPressed]}
                  onPress={() => select(e)}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{e.label}</Text>
                    <Text style={styles.rowPath} numberOfLines={1}>{e.path}</Text>
                  </View>
                  {e.source === 'recent' ? <Text style={styles.recentTag}>recent</Text> : null}
                </Pressable>
              )}
              ListEmptyComponent={
                loading ? (
                  <View style={styles.emptyList}><ActivityIndicator color={theme.accent} /></View>
                ) : (
                  <View style={styles.emptyList}>
                    <Text style={styles.emptyText}>{query ? 'No matches.' : 'No projects configured. Add TRUX_WORKSPACES or paste a path manually.'}</Text>
                  </View>
                )
              }
            />
          </>
        )}

        {runnableCatalog.length > 0 ? (
          <View style={styles.pickerWrap}>
            <Text style={styles.label}>Default provider (optional)</Text>
            <View style={styles.chipRow}>
              <Pressable
                style={[styles.chip, !defaultAgent && styles.chipSelected]}
                onPress={() => setDefaultAgent('')}
              >
                <Text style={[styles.chipText, !defaultAgent && styles.chipTextSelected]}>none</Text>
              </Pressable>
              {runnableCatalog.map((e) => (
                <Pressable
                  key={e.agent}
                  style={[styles.chip, defaultAgent === e.agent && styles.chipSelected]}
                  onPress={() => setDefaultAgent(e.agent)}
                >
                  <Text style={[styles.chipText, defaultAgent === e.agent && styles.chipTextSelected]}>{e.agent}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.footer}>
        <Pressable
          style={({ pressed }) => [styles.createBtn, (!name.trim() || (!cwd && !manualPath.trim()) || creating) && styles.createBtnDisabled, pressed && styles.createBtnPressed]}
          disabled={!name.trim() || (!cwd && !manualPath.trim()) || creating}
          onPress={() => void create()}
        >
          {creating ? (
            <ActivityIndicator color={theme.ink} size="small" />
          ) : (
            <Text style={styles.createBtnText}>Create project</Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  body: { flex: 1, padding: 16, gap: 12 },
  label: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  input: {
    backgroundColor: theme.surface1,
    borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14, paddingVertical: 12,
    color: theme.text, fontSize: 15, fontFamily: theme.fontSans,
  },
  pathHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggleText: { color: theme.accent, fontSize: 12, fontFamily: theme.fontSans },
  search: {
    backgroundColor: theme.surface1,
    borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14, paddingVertical: 12,
    color: theme.text, fontSize: 15, fontFamily: theme.fontSans,
  },
  selectedPath: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  selectedPathLabel: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono },
  selectedPathValue: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono, flex: 1, minWidth: 0 },
  list: { flex: 1 },
  row: {
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: theme.radiusSm, gap: 2,
  },
  rowSelected: { backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accent },
  rowPressed: { backgroundColor: theme.surface1 },
  rowText: { gap: 2 },
  rowLabel: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans },
  rowPath: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono },
  recentTag: {
    color: theme.textFaint, fontSize: 10, fontFamily: theme.fontMono,
    borderWidth: 1, borderColor: theme.line, borderRadius: theme.radiusSm,
    paddingHorizontal: 6, paddingVertical: 1,
  },
  emptyList: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans, textAlign: 'center', paddingHorizontal: 20 },
  pickerWrap: { gap: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: theme.radiusSm,
    borderWidth: 1, borderColor: theme.line,
    backgroundColor: theme.surface1,
  },
  chipSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: theme.text, fontSize: 13, fontFamily: theme.fontSans },
  chipTextSelected: { color: theme.ink, fontWeight: '600' },
  error: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  footer: { paddingHorizontal: 16, paddingVertical: 14, paddingBottom: 20 },
  createBtn: {
    backgroundColor: theme.accent, borderRadius: theme.radius,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  createBtnPressed: { backgroundColor: theme.accentBright },
  createBtnDisabled: { backgroundColor: theme.surface3 },
  createBtnText: { color: theme.ink, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
})
