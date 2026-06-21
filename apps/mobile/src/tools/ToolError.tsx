// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Source: vendor/happy/packages/happy-app/sources/components/tools/ToolError.tsx
//
// Re-skin: stripped useUnistyles → direct theme import.
// theme.colors.box.error.* → trux error/surface tokens.

import { Text, View, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { parseToolUseError } from './utils'
import { theme } from '../theme'

export function ToolError(props: { message: string }) {
  const { isToolUseError, errorMessage } = parseToolUseError(props.message)
  const displayMessage = isToolUseError && errorMessage ? errorMessage : props.message
  return (
    <View style={[styles.errorContainer, isToolUseError && styles.toolUseErrorContainer]}>
      {isToolUseError ? <Ionicons name="warning" size={16} color={theme.warn} /> : null}
      <Text style={[styles.errorText, isToolUseError && styles.toolUseErrorText]}>{displayMessage}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(239,111,108,0.08)',
    borderRadius: 6,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,111,108,0.2)',
    marginBottom: 12,
    maxHeight: 115,
    overflow: 'hidden',
  },
  toolUseErrorContainer: {},
  errorText: { fontSize: 13, color: theme.error, flex: 1 },
  toolUseErrorText: { color: theme.error },
})
