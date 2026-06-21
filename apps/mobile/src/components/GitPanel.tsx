import { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { GitFileStatus, GitStatusResult } from '@trux/protocol'
import { api } from '@trux/client/api'
import { theme } from '../theme'
import { haptic } from '../haptics'

interface Props {
  conversationId: string
  visible: boolean
  onClose: () => void
}

// Native git panel: review & commit the agent's work from the phone. Mirrors the
// PWA's GitPanel (apps/frontend) on the same safe-ops backend routes — status,
// stage/unstage, per-file diff, commit. No reset/push/rebase (a fat-finger there
// is unrecoverable). Presented as a full-screen Modal; the file diff stacks a
// second Modal on top.
export function GitPanel({ conversationId, visible, onClose }: Props): React.ReactElement {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)
  const [diffFor, setDiffFor] = useState<{ path: string; staged: boolean } | null>(null)
  const [diffContent, setDiffContent] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      setStatus(await api.gitStatus(conversationId))
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (visible) void reload()
  }, [visible, conversationId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (f: GitFileStatus): Promise<void> => {
    haptic('light')
    try {
      if (f.staged) await api.gitUnstage(conversationId, f.path)
      else await api.gitStage(conversationId, f.path)
      await reload()
    } catch {
      // best-effort
    }
  }

  const openDiff = async (path: string, staged: boolean): Promise<void> => {
    setDiffFor({ path, staged })
    setDiffContent('')
    setDiffLoading(true)
    try {
      const { diff } = await api.gitDiff(conversationId, { path, staged })
      setDiffContent(diff)
    } catch {
      setDiffContent('')
    } finally {
      setDiffLoading(false)
    }
  }

  const commit = async (): Promise<void> => {
    if (!commitMsg.trim() || committing) return
    setCommitting(true)
    setCommitResult(null)
    try {
      const r = await api.gitCommit(conversationId, commitMsg)
      if (r.ok) {
        setCommitMsg('')
        setCommitResult(`Committed ${r.hash}`)
        haptic('success')
        await reload()
      } else {
        setCommitResult(r.error ?? 'Commit failed')
        haptic('error')
      }
    } finally {
      setCommitting(false)
    }
  }

  const repo = status?.repo ? status : null
  const files = repo ? repo.files : []
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Git</Text>
          {repo?.branch ? <Text style={styles.branch}>{repo.branch}</Text> : null}
          {repo && (repo.ahead > 0 || repo.behind > 0) ? (
            <Text style={styles.tracking}>
              {repo.ahead > 0 ? `↑${repo.ahead}` : ''}
              {repo.behind > 0 ? `↓${repo.behind}` : ''}
            </Text>
          ) : null}
          <View style={styles.headerSpacer} />
          <Pressable hitSlop={12} onPress={onClose} accessibilityLabel="Close git panel">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={theme.accent} /></View>
        ) : !repo ? (
          <View style={styles.center}><Text style={styles.muted}>Not a git repository.</Text></View>
        ) : (
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled">
            {staged.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Staged</Text>
                {staged.map((f) => (
                  <FileRow key={f.path} file={f} status={f.index} onToggle={() => void toggle(f)} onDiff={() => void openDiff(f.path, true)} />
                ))}
              </View>
            ) : null}

            {unstaged.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Changes</Text>
                {unstaged.map((f) => (
                  <FileRow key={f.path} file={f} status={f.work} onToggle={() => void toggle(f)} onDiff={() => void openDiff(f.path, false)} />
                ))}
              </View>
            ) : null}

            {files.length === 0 ? (
              <Text style={styles.muted}>Clean — nothing to commit.</Text>
            ) : null}

            <View style={styles.commitArea}>
              <TextInput
                style={styles.commitMsg}
                placeholder="Commit message…"
                placeholderTextColor={theme.textFaint}
                value={commitMsg}
                onChangeText={setCommitMsg}
                multiline
              />
              <Pressable
                style={({ pressed }) => [
                  styles.commitBtn,
                  (committing || staged.length === 0 || !commitMsg.trim()) && styles.commitBtnDisabled,
                  pressed && styles.commitBtnPressed,
                ]}
                disabled={committing || staged.length === 0 || !commitMsg.trim()}
                onPress={() => void commit()}
              >
                <Text style={styles.commitBtnText}>{committing ? 'Committing…' : 'Commit staged'}</Text>
              </Pressable>
              {commitResult ? <Text style={styles.commitResult}>{commitResult}</Text> : null}
            </View>
          </ScrollView>
        )}

        {/* Per-file diff, stacked on top */}
        <Modal visible={!!diffFor} animationType="slide" onRequestClose={() => setDiffFor(null)} transparent={false}>
          <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
            <View style={styles.header}>
              <Text style={styles.diffTitle} numberOfLines={1}>{diffFor?.path}</Text>
              <View style={styles.headerSpacer} />
              <Pressable hitSlop={12} onPress={() => setDiffFor(null)} accessibilityLabel="Close diff">
                <Text style={styles.close}>✕</Text>
              </Pressable>
            </View>
            {diffLoading ? (
              <View style={styles.center}><ActivityIndicator color={theme.accent} /></View>
            ) : (
              <UnifiedDiff diff={diffContent} />
            )}
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  )
}

function FileRow({
  file,
  status,
  onToggle,
  onDiff,
}: {
  file: GitFileStatus
  status: string
  onToggle: () => void
  onDiff: () => void
}): React.ReactElement {
  return (
    <View style={styles.fileRow}>
      <Pressable
        style={[styles.stageBtn, file.staged && styles.stageBtnStaged]}
        onPress={onToggle}
        hitSlop={8}
        accessibilityLabel={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
      >
        <Text style={styles.stageBtnText}>{file.staged ? '−' : '+'}</Text>
      </Pressable>
      <Pressable style={styles.filePathBtn} onPress={onDiff}>
        <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
      </Pressable>
      <Text style={styles.fileStatus}>{status.trim() || '•'}</Text>
    </View>
  )
}

// Render a git unified-diff string line-by-line: +added green, -removed red,
// @@ hunk headers dim accent, everything else context. (api.gitDiff returns the
// raw unified diff; this is simpler and more faithful than re-diffing old/new.)
function UnifiedDiff({ diff }: { diff: string }): React.ReactElement {
  if (!diff.trim()) {
    return <View style={styles.center}><Text style={styles.muted}>No changes.</Text></View>
  }
  const lines = diff.replace(/\n$/, '').split('\n')
  return (
    <ScrollView style={styles.diffScroll} contentContainerStyle={styles.diffBody}>
      {lines.map((line, i) => {
        const kind = line.startsWith('+') && !line.startsWith('+++')
          ? 'add'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'remove'
            : line.startsWith('@@')
              ? 'hunk'
              : 'context'
        return (
          <Text key={i} style={[styles.diffLine, styles[`diff_${kind}` as const]]}>
            {line || ' '}
          </Text>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
  branch: { color: theme.accentBright, fontSize: 13, fontFamily: theme.fontMono },
  tracking: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono },
  headerSpacer: { flex: 1 },
  close: { color: theme.textDim, fontSize: 18, fontFamily: theme.fontSans },
  diffTitle: { color: theme.text, fontSize: 14, fontFamily: theme.fontMono, flexShrink: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
  scroll: { flex: 1 },
  scrollBody: { padding: 14, gap: 16 },
  section: { gap: 6 },
  sectionLabel: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  stageBtn: {
    width: 32,
    height: 32,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageBtnStaged: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  stageBtnText: { color: theme.text, fontSize: 16, fontFamily: theme.fontMono },
  filePathBtn: { flex: 1 },
  filePath: { color: theme.text, fontSize: 14, fontFamily: theme.fontMono },
  fileStatus: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, width: 22, textAlign: 'center' },
  commitArea: { gap: 10, marginTop: 4 },
  commitMsg: {
    minHeight: 72,
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontSans,
    textAlignVertical: 'top',
  },
  commitBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  commitBtnPressed: { backgroundColor: theme.accentBright },
  commitBtnDisabled: { backgroundColor: theme.surface3 },
  commitBtnText: { color: theme.ink, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
  commitResult: { color: theme.ok, fontSize: 13, fontFamily: theme.fontMono },
  diffScroll: { flex: 1 },
  diffBody: { padding: 12 },
  diffLine: { fontSize: 12, lineHeight: 17, fontFamily: theme.fontMono },
  diff_add: { color: theme.ok },
  diff_remove: { color: theme.error },
  diff_hunk: { color: theme.accentBright },
  diff_context: { color: theme.textDim },
})
