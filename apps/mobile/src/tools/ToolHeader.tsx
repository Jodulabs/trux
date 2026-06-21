// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Source: vendor/happy/packages/happy-app/sources/components/tools/ToolHeader.tsx
//
// Re-skin: stripped useUnistyles → direct theme import.
// theme.colors.header.tint → theme.text, theme.colors.text → theme.text,
// theme.colors.textSecondary → theme.textDim.

import { Text, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ToolCall } from './types'
import { knownTools } from './knownTools'
import { theme } from '../theme'

interface ToolHeaderProps {
  tool: ToolCall
}

export function ToolHeader({ tool }: ToolHeaderProps) {
  const knownTool = knownTools[tool.name]
  let toolTitle = tool.name
  if (knownTool?.title) {
    if (typeof knownTool.title === 'function') {
      toolTitle = knownTool.title({ tool, metadata: null })
    } else {
      toolTitle = knownTool.title
    }
  }
  const icon = knownTool?.icon ? knownTool.icon(18, theme.text) : <Ionicons name="construct-outline" size={18} color={theme.text} />
  let subtitle: string | null = null
  if (knownTool && typeof knownTool.extractSubtitle === 'function') {
    const extractedSubtitle = knownTool.extractSubtitle({ tool, metadata: null })
    if (typeof extractedSubtitle === 'string' && extractedSubtitle) subtitle = extractedSubtitle
  }
  return (
    <View style={styles.container}>
      <View style={styles.titleContainer}>
        <View style={styles.titleRow}>
          {icon}
          <Text style={styles.title} numberOfLines={1}>
            {toolTitle}
          </Text>
        </View>
        {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexGrow: 1, flexBasis: 0, paddingHorizontal: 4 },
  titleContainer: { flexDirection: 'column', alignItems: 'center', flexGrow: 1, flexBasis: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 14, fontWeight: '500', color: theme.text, textAlign: 'center' },
  subtitle: { fontSize: 11, color: theme.textDim, textAlign: 'center', marginTop: 2 },
})
