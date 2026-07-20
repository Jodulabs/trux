import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { theme } from '../../theme'
import { InlineGitPanel } from './InlineGitPanel'
import { InlineTerminal } from './InlineTerminal'
import { InlinePreview } from './InlinePreview'

type Tab = 'git' | 'terminal' | 'preview'

interface Props {
  conversationId: string
  previewPort: number | null
  hasRepo: boolean
}

export function DesktopDock({ conversationId, previewPort, hasRepo }: Props): React.ReactElement {
  const [active, setActive] = useState<Tab | null>(null)

  const tabs: { key: Tab; label: string; enabled: boolean }[] = [
    { key: 'git', label: 'Git', enabled: hasRepo },
    { key: 'terminal', label: 'Terminal', enabled: true },
    { key: 'preview', label: 'Preview', enabled: previewPort != null },
  ]

  return (
    <View style={styles.shell}>
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <Pressable
            key={t.key}
            style={[styles.tab, active === t.key && styles.tabActive, !t.enabled && styles.tabDisabled]}
            onPress={() => t.enabled && setActive(active === t.key ? null : t.key)}
            disabled={!t.enabled}
          >
            <Text style={[styles.tabText, active === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {active ? (
        <View style={styles.panel}>
          {active === 'git' && hasRepo ? <InlineGitPanel conversationId={conversationId} /> : null}
          {active === 'terminal' ? <InlineTerminal conversationId={conversationId} /> : null}
          {active === 'preview' && previewPort != null ? <InlinePreview port={previewPort} /> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    width: 320,
    backgroundColor: theme.ink,
    borderLeftWidth: 1,
    borderLeftColor: theme.lineSoft,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: theme.surface1,
    borderBottomWidth: 2,
    borderBottomColor: theme.accent,
  },
  tabDisabled: { opacity: 0.3 },
  tabText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontSans },
  tabTextActive: { color: theme.text, fontFamily: `${theme.fontSans}-600` },
  panel: { flex: 1 },
})
