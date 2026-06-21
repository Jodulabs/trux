// Simple monospace code view — replaces happy's CodeView for the tool-view
// fallback rendering. trux doesn't need syntax highlighting in the tool card
// fallback (the per-tool views handle their own rendering); this is just a
// scrollable monospace text block for raw JSON input/output.
// Source: vendor/happy/packages/happy-app/sources/components/CodeView.tsx (simplified)

import React from 'react'
import { Text, ScrollView, StyleSheet, Platform } from 'react-native'
import { theme } from '../theme'

interface CodeViewProps {
  code: string
  maxHeight?: number
}

export const CodeView = React.memo<CodeViewProps>(({ code, maxHeight }) => {
  return (
    <ScrollView style={[styles.container, maxHeight ? { maxHeight } : undefined]} horizontal>
      <Text style={styles.code}>{code}</Text>
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.ink,
    borderRadius: 6,
    padding: 10,
    marginTop: 4,
  },
  code: {
    fontFamily: Platform.select({ ios: 'IBM Plex Mono', default: 'monospace' }),
    fontSize: 12,
    color: theme.textDim,
    lineHeight: 16,
  },
})
