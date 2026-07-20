import { useCallback, useEffect, useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet, ScrollView } from 'react-native'
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

type PathMode = 'browse' | 'search' | 'manual'

interface PathEntry {
  label: string
  path: string
  branch: string | null
  source: 'workspace' | 'recent'
}

export default function NewProjectScreen(): React.ReactElement {
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const loadProjects = useStore((s) => s.loadProjects)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([])
  const [mode, setMode] = useState<PathMode>('browse')
  const [query, setQuery] = useState('')
  const [manualPath, setManualPath] = useState('')
  const [name, setName] = useState('')
  const [defaultAgent, setDefaultAgent] = useState<AgentName | ''>('')
  const [cwd, setCwd] = useState('')
  const [browsePath, setBrowsePath] = useState<string | null>(null)
  const [browseParent, setBrowseParent] = useState<string | null>(null)
  const [browseEntries, setBrowseEntries] = useState<{ name: string; path: string }[]>([])
  const [crumbs, setCrumbs] = useState<{ name: string; path: string }[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [browseLoading, setBrowseLoading] = useState(false)

  const loadBrowse = useCallback(async (path?: string): Promise<void> => {
    setBrowseLoading(true)
    setError(null)
    try {
      const listing = await api.listDirs(path)
      setBrowsePath(listing.path)
      setBrowseParent(listing.parent)
      setBrowseEntries(listing.entries)
      // Build crumbs from listing.path segments relative to first segment
      const parts = listing.path.replace(/\/$/, '').split('/').filter(Boolean)
      const segs: { name: string; path: string }[] = []
      let acc = listing.path.startsWith('/') ? '' : ''
      for (let i = 0; i < parts.length; i++) {
        acc += '/' + parts[i]
        segs.push({ name: parts[i]!, path: acc })
      }
      // Keep last ~4 crumbs visible
      setCrumbs(segs)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBrowseLoading(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBrowse()
    void Promise.all([
      api.listWorkspaces().then(setWorkspaces).catch(() => {}),
      api.getCatalog().then((r) => {
        const list = r.catalog ?? []
        setCatalog(list)
        const first = list.find((e) => e.runnable) ?? list[0]
        if (first) setDefaultAgent(first.agent)
      }).catch(() => {}),
    ])
  }, [loadBrowse])

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
    return [...recent, ...ws.filter((w) => !seen.has(w.path))]
  }, [conversations, workspaces])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.label.toLowerCase().includes(q) || e.path.toLowerCase().includes(q) || (e.branch?.toLowerCase().includes(q) ?? false),
    )
  }, [entries, query])

  useEffect(() => {
    if (cwd && !name) setName(basename(cwd))
  }, [cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  const useFolder = (path: string): void => {
    setCwd(path)
    if (!name) setName(basename(path))
    haptic('light')
  }

  const create = async (): Promise<void> => {
    const finalCwd = mode === 'manual' ? manualPath.trim() : cwd
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
  const canCreate = Boolean(name.trim() && (mode === 'manual' ? manualPath.trim() : cwd) && !creating)

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
          <View style={styles.modeRow}>
            {([
              ['browse', 'Browse'],
              ['search', 'Search'],
              ['manual', 'Paste'],
            ] as const).map(([id, label]) => (
              <Pressable key={id} hitSlop={6} onPress={() => setMode(id)}>
                <Text style={[styles.toggleText, mode === id && styles.toggleActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {mode === 'manual' ? (
          <TextInput
            style={[styles.input, { fontFamily: theme.fontMono }]}
            value={manualPath}
            onChangeText={setManualPath}
            placeholder="/absolute/path/to/codebase"
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : null}

        {mode === 'search' ? (
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
            <FlatList
              data={filtered}
              keyExtractor={(e) => e.path}
              style={styles.list}
              renderItem={({ item: e }) => (
                <Pressable
                  style={({ pressed }) => [styles.row, cwd === e.path && styles.rowSelected, pressed && cwd !== e.path && styles.rowPressed]}
                  onPress={() => { setCwd(e.path); setQuery(e.label); haptic('light') }}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>{e.label}</Text>
                    <Text style={styles.rowPath} numberOfLines={1}>{e.path}</Text>
                  </View>
                  {e.source === 'recent' ? <Text style={styles.recentTag}>recent</Text> : null}
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={styles.emptyList}>
                  <Text style={styles.emptyText}>{query ? 'No matches.' : 'No recent or workspace paths yet.'}</Text>
                </View>
              }
            />
          </>
        ) : null}

        {mode === 'browse' ? (
          <View style={styles.browse}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbRow}>
              {browseParent ? (
                <Pressable onPress={() => void loadBrowse(browseParent)} style={styles.crumbBtn}>
                  <Text style={styles.crumbText}>↑ Up</Text>
                </Pressable>
              ) : null}
              {crumbs.slice(-4).map((c) => (
                <Pressable key={c.path} onPress={() => void loadBrowse(c.path)} style={styles.crumbBtn}>
                  <Text style={styles.crumbText} numberOfLines={1}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {browsePath ? (
              <View style={styles.selectedPath}>
                <Text style={styles.selectedPathLabel} numberOfLines={1}>{browsePath}</Text>
                <Pressable style={styles.useBtn} onPress={() => useFolder(browsePath)}>
                  <Text style={styles.useBtnText}>Use this folder</Text>
                </Pressable>
              </View>
            ) : null}
            {cwd ? (
              <Text style={styles.selectedNote}>Selected: {cwd}</Text>
            ) : null}
            {browseLoading || loading ? (
              <ActivityIndicator color={theme.accent} style={{ marginTop: 16 }} />
            ) : (
              <FlatList
                data={browseEntries}
                keyExtractor={(e) => e.path}
                style={styles.list}
                renderItem={({ item }) => (
                  <Pressable
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                    onPress={() => void loadBrowse(item.path)}
                  >
                    <Text style={styles.folderMark}>▸</Text>
                    <Text style={styles.rowLabel} numberOfLines={1}>{item.name}</Text>
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={styles.emptyList}>
                    <Text style={styles.emptyText}>No subfolders here. Use this folder, or go up.</Text>
                  </View>
                }
              />
            )}
          </View>
        ) : null}

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
          style={({ pressed }) => [styles.createBtn, !canCreate && styles.createBtnDisabled, pressed && styles.createBtnPressed]}
          disabled={!canCreate}
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
  modeRow: { flexDirection: 'row', gap: 12 },
  toggleText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontSans },
  toggleActive: { color: theme.accentBright },
  search: {
    backgroundColor: theme.surface1,
    borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14, paddingVertical: 12,
    color: theme.text, fontSize: 15, fontFamily: theme.fontSans,
  },
  browse: { flex: 1, gap: 8, minHeight: 180 },
  crumbRow: { flexDirection: 'row', gap: 6, alignItems: 'center', paddingVertical: 4 },
  crumbBtn: {
    backgroundColor: theme.surface2,
    borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 10, paddingVertical: 6,
    maxWidth: 120,
  },
  crumbText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono },
  selectedPath: { gap: 8 },
  selectedPathLabel: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono },
  selectedNote: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono },
  useBtn: {
    alignSelf: 'flex-start',
    backgroundColor: theme.accentBright,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  useBtnText: { color: theme.ink, fontSize: 13, fontFamily: `${theme.fontSans}-600` },
  list: { flex: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
    borderRadius: theme.radiusSm,
  },
  rowSelected: { backgroundColor: theme.accentSoft, borderWidth: 1, borderColor: theme.accent },
  rowPressed: { backgroundColor: theme.surface1 },
  rowText: { gap: 2, flex: 1, minWidth: 0 },
  rowLabel: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, flex: 1 },
  rowPath: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono },
  folderMark: { fontSize: 14 },
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
    backgroundColor: theme.accentBright, borderRadius: theme.radius,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center', minHeight: 50,
  },
  createBtnPressed: { backgroundColor: theme.accent },
  createBtnDisabled: { backgroundColor: theme.surface3 },
  createBtnText: { color: theme.ink, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
})
