import { useEffect, useState } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { AgentCatalogEntry, GitStatusResult } from '@trux/protocol'
import { useStore } from '@trux/client/store'
import { api } from '@trux/client/api'
import { theme, STATUS_COLORS } from '../../../src/theme'
import { useIsDesktop } from '../../../src/hooks/useIsDesktop'
import { DesktopDock } from '../../../src/components/desktop/DesktopDock'

import { ConversationView } from '../../../src/components/ConversationView'
import { GitPanel } from '../../../src/components/GitPanel'
import { TerminalPane } from '../../../src/components/TerminalPane'
import { PreviewPane } from '../../../src/components/PreviewPane'

// Session screen: status dot + title + agent·model chip + account state in the
// top bar, then the ConversationView (transcript + composer). The view owns its
// WS connection via the shared connectionManager. A git badge opens the GitPanel
// for review/commit when the conversation is a repo.
export default function SessionScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const isDesktop = useIsDesktop()
  const conversations = useStore((s) => s.conversations)
  const conv = conversations.find((c) => c.id === id)
  const convMeta = useStore((s) => (s.convMeta[id] ?? undefined))
  const title = conv?.title ?? conv?.cwd?.replace(/\/$/, '').split('/').pop() ?? id
  const previewPort = useStore((s) => s.previewPort)
  const liveStatus = convMeta?.status ?? conv?.status ?? 'idle'

  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitOpen, setGitOpen] = useState(false)
  const [termOpen, setTermOpen] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)
  const [catalog, setCatalog] = useState<AgentCatalogEntry | null>(null)

  const loadGit = (): void => {
    void api.gitStatus(id).then(setGitStatus).catch(() => setGitStatus(null))
  }
  useEffect(() => { loadGit() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the agent's catalog entry so the top bar can show account status
  // (connected/disconnected) alongside the agent·model chip.
  useEffect(() => {
    if (!conv?.agent) return
    void api.getCatalog().then((r) => {
      setCatalog(r.catalog.find((e) => e.agent === conv.agent) ?? null)
    }).catch(() => {})
  }, [conv?.agent])

  const repo = gitStatus?.repo ? gitStatus : null
  const accountStatus = catalog?.accounts[0]?.status ?? null
  const modelLabel = conv?.model ?? 'default'

  if (isDesktop) {
    return (
      <View style={styles.desktopShell}>
        <View style={styles.desktopMain}>
          <View style={styles.desktopBar}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
            <Text style={styles.desktopTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.agentModelChip}>{conv?.agent} · {modelLabel}</Text>
            {accountStatus ? <Text style={styles.accountStatus}>{accountStatus}</Text> : null}
          </View>
          <ConversationView id={id} onBack={() => {}} />
        </View>
        <DesktopDock conversationId={id} previewPort={previewPort} hasRepo={!!repo} />
        <GitPanel
          conversationId={id}
          visible={gitOpen}
          onClose={() => { setGitOpen(false); loadGit() }}
        />
        <TerminalPane
          conversationId={id}
          visible={termOpen}
          onClose={() => setTermOpen(false)}
        />
        {previewPort != null ? (
          <PreviewPane
            conversationId={id}
            port={previewPort}
            visible={prevOpen}
            onClose={() => setPrevOpen(false)}
          />
        ) : null}
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[liveStatus] ?? theme.textFaint }]} />
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <Text style={styles.agentModelChip} numberOfLines={1}>{conv?.agent} · {modelLabel}</Text>
        <Pressable
          style={styles.termBadge}
          onPress={() => setTermOpen(true)}
          accessibilityLabel="Open terminal"
          hitSlop={8}
        >
          <Text style={styles.termBadgeText}>⌗</Text>
        </Pressable>
        {previewPort != null ? (
          <Pressable
            style={styles.termBadge}
            onPress={() => setPrevOpen(true)}
            accessibilityLabel="Open preview"
            hitSlop={8}
          >
            <Text style={styles.termBadgeText}>◳</Text>
          </Pressable>
        ) : null}
        {repo ? (
          <Pressable
            style={[styles.gitBadge, repo.dirty && styles.gitBadgeDirty]}
            onPress={() => setGitOpen(true)}
            accessibilityLabel="Open git panel"
            hitSlop={8}
          >
            <Text style={styles.gitBadgeText} numberOfLines={1}>
              {repo.branch ?? 'HEAD'}{repo.dirty ? ' ●' : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {liveStatus === 'awaiting_approval' ? (
        <View style={styles.approvalBar}>
          <Text style={styles.approvalText}>Approval waiting — tap the prompt below</Text>
        </View>
      ) : null}
      {accountStatus && accountStatus !== 'connected' ? (
        <View style={styles.accountBar}>
          <Text style={styles.accountText}>{conv?.agent} account {accountStatus}</Text>
        </View>
      ) : null}
      <ConversationView id={id} onBack={() => router.back()} />
      <GitPanel
        conversationId={id}
        visible={gitOpen}
        onClose={() => { setGitOpen(false); loadGit() }}
      />
      <TerminalPane
        conversationId={id}
        visible={termOpen}
        onClose={() => setTermOpen(false)}
      />
      {previewPort != null ? (
        <PreviewPane
          conversationId={id}
          port={previewPort}
          visible={prevOpen}
          onClose={() => setPrevOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500`, flex: 1, minWidth: 0 },
  agentModelChip: {
    color: theme.textDim,
    fontSize: 11,
    fontFamily: theme.fontMono,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 140,
  },
  accountStatus: { color: theme.textFaint, fontSize: 10, fontFamily: theme.fontMono },
  approvalBar: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: theme.accentSoft,
    borderBottomWidth: 1,
    borderBottomColor: theme.accent,
  },
  approvalText: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono, textAlign: 'center' },
  accountBar: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    backgroundColor: theme.surface2,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  accountText: { color: theme.warn, fontSize: 11, fontFamily: theme.fontMono, textAlign: 'center' },
  gitBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
    maxWidth: 140,
  },
  gitBadgeDirty: { borderColor: theme.accent },
  gitBadgeText: { color: theme.accentBright, fontSize: 12, fontFamily: theme.fontMono },
  termBadge: {
    width: 32,
    height: 32,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  termBadgeText: { color: theme.accentBright, fontSize: 16, fontFamily: theme.fontMono, lineHeight: 18 },
  desktopShell: { flex: 1, flexDirection: 'row', backgroundColor: theme.ink },
  desktopMain: { flex: 1, minWidth: 0 },
  desktopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  desktopTitle: { color: theme.text, fontSize: 14, fontFamily: `${theme.fontSans}-600`, flex: 1, minWidth: 0 },
})
