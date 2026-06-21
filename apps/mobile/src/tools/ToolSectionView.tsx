// Vendored from happy (slopus/happy, MIT), re-skinned to trux theme tokens.
// Source: vendor/happy/packages/happy-app/sources/components/tools/ToolSectionView.tsx
//
// Re-skin: stripped react-native-unistyles StyleSheet.create((theme) => ...) →
// plain RN StyleSheet.create with trux theme values inlined.

import React from 'react'
import { Text, View, StyleSheet } from 'react-native'
import { theme } from '../theme'

interface ToolSectionViewProps {
  title?: string
  fullWidth?: boolean
  children: React.ReactNode
}

export const ToolSectionView = React.memo<ToolSectionViewProps>(({ title, children, fullWidth }) => {
  return (
    <View style={[styles.section, fullWidth && styles.fullWidthSection]}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={fullWidth ? styles.fullWidthContent : undefined}>{children}</View>
    </View>
  )
})

const styles = StyleSheet.create({
  section: { marginBottom: 12, overflow: 'visible' },
  fullWidthSection: { marginHorizontal: -12, marginTop: -8 },
  fullWidthContent: {},
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.textDim,
    marginBottom: 6,
    marginHorizontal: 12,
    textTransform: 'uppercase',
  },
})
