// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Source: vendor/happy/packages/happy-app/sources/components/tools/ToolStatusIndicator.tsx
//
// Re-skin: hardcoded #007AFF/#34C759/#FF3B30 → trux accent/ok/error tokens.

import { View, StyleSheet, ActivityIndicator } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ToolCall } from './types'
import { theme } from '../theme'

export function ToolStatusIndicator({ tool }: { tool: ToolCall }) {
  return (
    <View style={styles.container}>
      <StatusIndicator state={tool.state} />
    </View>
  )
}

function StatusIndicator({ state }: { state: ToolCall['state'] }) {
  switch (state) {
    case 'running':
      return <ActivityIndicator size="small" color={theme.accent} />
    case 'completed':
      return <Ionicons name="checkmark-circle" size={22} color={theme.ok} />
    case 'error':
      return <Ionicons name="close-circle" size={22} color={theme.error} />
    default:
      return null
  }
}

const styles = StyleSheet.create({
  container: { width: 22, alignItems: 'center', justifyContent: 'center' },
})
