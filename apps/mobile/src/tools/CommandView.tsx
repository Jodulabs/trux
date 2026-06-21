// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Source: vendor/happy/packages/happy-app/sources/components/CommandView.tsx
//
// Re-skin: stripped useUnistyles → direct theme import; theme property names
// mapped: terminal.background → ink, terminal.prompt → accent,
// terminal.command → text, terminal.stdout → textDim, terminal.stderr/error → error.

import React from 'react'
import { Text, View, StyleSheet, Platform } from 'react-native'
import { theme } from '../theme'

interface CommandViewProps {
  command: string
  prompt?: string
  stdout?: string | null
  stderr?: string | null
  error?: string | null
  maxHeight?: number
  fullWidth?: boolean
  hideEmptyOutput?: boolean
}

export const CommandView = React.memo<CommandViewProps>(
  ({ command, prompt = '$', stdout, stderr, error, maxHeight, fullWidth, hideEmptyOutput }) => {
    const hasNewProps = stdout !== undefined || stderr !== undefined || error !== undefined
    return (
      <View
        style={[
          styles.container,
          maxHeight ? { maxHeight } : undefined,
          fullWidth ? { width: '100%' } : undefined,
        ]}
      >
        <View style={styles.line}>
          <Text style={styles.promptText}>{prompt} </Text>
          <Text style={styles.commandText}>{command}</Text>
        </View>
        {hasNewProps ? (
          <>
            {stdout && stdout.trim() ? <Text style={styles.stdout}>{stdout}</Text> : null}
            {stderr && stderr.trim() ? <Text style={styles.stderr}>{stderr}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {!stdout && !stderr && !error && !hideEmptyOutput ? (
              <Text style={styles.emptyOutput}>[Command completed with no output]</Text>
            ) : null}
          </>
        ) : null}
      </View>
    )
  },
)

const monoFont = Platform.select({ ios: 'IBM Plex Mono', android: 'IBM Plex Mono', default: 'monospace' })

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.ink,
    borderRadius: 8,
    overflow: 'hidden',
    padding: 16,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
  },
  line: { alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap' },
  promptText: { fontFamily: monoFont, fontSize: 14, lineHeight: 20, color: theme.accent, fontWeight: '600' },
  commandText: { fontFamily: monoFont, fontSize: 14, color: theme.text, lineHeight: 20, flex: 1 },
  stdout: { fontFamily: monoFont, fontSize: 13, color: theme.textDim, lineHeight: 18, marginTop: 8 },
  stderr: { fontFamily: monoFont, fontSize: 13, color: theme.error, lineHeight: 18, marginTop: 8 },
  errorText: { fontFamily: monoFont, fontSize: 13, color: theme.error, lineHeight: 18, marginTop: 8 },
  emptyOutput: {
    fontFamily: monoFont,
    fontSize: 13,
    color: theme.textFaint,
    lineHeight: 18,
    marginTop: 8,
    fontStyle: 'italic',
  },
})
