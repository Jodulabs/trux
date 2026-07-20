import { useEffect, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native'
import type { GitFileStatus, GitStatusResult } from '@trux/protocol'
import { api } from '@trux/client/api'
import { theme } from '../../theme'

interface Props {
  conversationId: string
}

export function InlineGitPanel({ conversationId }: Props): React.ReactElement {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)

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
    void reload()
  }, [conversationId])

  const toggle = async (f: GitFileStatus): Promise<void> => {
    try {
      if (f.staged) await api.gitUnstage(conversationId, f.path)
      else await api.gitStage(conversationId, f.path)
      await reload()
    } catch {
      // best-effort
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
        await reload()
      } else {
        setCommitResult(r.error ?? 'Commit failed')
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
    <View style={styles.shell}>
      <View style={styles.header}>
        <Text style={styles.title}>Git</Text>
        {repo?.branch ? <Text style={styles.branch}>{repo.branch}</Text> : null}
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.accent} /></View>
      ) : !repo ? (
        <View style={styles.center}><Text style={styles.muted}>Not a git repository.</Text></View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
          {staged.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Staged</Text>
              {staged.map((f) => (
                <FileRow key={f.path} file={f} status={f.index} onToggle={() => void toggle(f)} />
              ))}
            </View>
          ) : null}
          {unstaged.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Changes</Text>
              {unstaged.map((f) => (
                <FileRow key={f.path} file={f} status={f.work} onToggle={() => void toggle(f)} />
              ))}
            </View>
          ) : null}
          {files.length === 0 ? <Text style={styles.muted}>Clean — nothing to commit.</Text> : null}
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
    </View>
  )
}

function FileRow({
  file,
  status,
  onToggle,
}: {
  file: GitFileStatus
  status: string
  onToggle: () => void
}): React.ReactElement {
  return (
    <Pressable style={styles.fileRow} onPress={onToggle}>
      <Text style={[styles.fileStatus, status === 'M' && styles.modified, status === 'A' && styles.added, status === 'D' && styles.deleted]}>
        {status}
      </Text>
      <Text style={styles.filePath} numberOfLines={1}>{file.path}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  title: { color: theme.text, fontSize: 14, fontFamily: `${theme.fontSans}-600` },
  branch: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  muted: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontSans },
  scroll: { flex: 1 },
  scrollBody: { padding: 12, gap: 12 },
  section: { gap: 4 },
  sectionLabel: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  fileStatus: { color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono, width: 16 },
  modified: { color: theme.accentBright },
  added: { color: '#4ade80' },
  deleted: { color: theme.error },
  filePath: { color: theme.text, fontSize: 12, fontFamily: theme.fontMono, flex: 1 },
  commitArea: { gap: 8, marginTop: 8 },
  commitMsg: {
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.text,
    fontSize: 12,
    fontFamily: theme.fontSans,
    minHeight: 44,
  },
  commitBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radiusSm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  commitBtnDisabled: { backgroundColor: theme.surface3 },
  commitBtnPressed: { backgroundColor: theme.accentBright },
  commitBtnText: { color: theme.ink, fontSize: 12, fontFamily: `${theme.fontSans}-600` },
  commitResult: { color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono },
})
