// Simple inline diff renderer for the native tool-views. Replaces happy's
// PierreDiffView (which pulls react-native-reanimated + skia + a diff engine).
// This is a line-by-line unified diff: added lines in green, removed in red,
// context in dim text. Sufficient for Edit/Write tool cards.
//
// trux's diff rendering for the dedicated diff pane (Phase B3) may later
// adopt react-native-diff-view for syntax-highlighted split view; this is the
// minimal renderer that makes the tool cards work.

import React from 'react'
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native'
import { theme } from '../theme'

interface DiffViewProps {
  oldText: string
  newText: string
  showLineNumbers?: boolean
  showPlusMinusSymbols?: boolean
}

type DiffLine = { type: 'add' | 'remove' | 'context'; text: string; oldLine?: number; newLine?: number }

// Minimal line diff: compare old vs new line-by-line using LCS. For the tool
// card context (old_string → new_string in Edit, '' → content in Write), a
// simple line diff is sufficient — we're not diffing whole files.
function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: DiffLine[] = []

  // LCS table
  const m = oldLines.length
  const n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  let i = 0,
    j = 0,
    oldLine = 1,
    newLine = 1
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'context', text: oldLines[i], oldLine, newLine })
      i++
      j++
      oldLine++
      newLine++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', text: oldLines[i], oldLine })
      i++
      oldLine++
    } else {
      result.push({ type: 'add', text: newLines[j], newLine })
      j++
      newLine++
    }
  }
  while (i < m) {
    result.push({ type: 'remove', text: oldLines[i], oldLine })
    i++
    oldLine++
  }
  while (j < n) {
    result.push({ type: 'add', text: newLines[j], newLine })
    j++
    newLine++
  }
  return result
}

export const DiffView = React.memo<DiffViewProps>(({ oldText, newText, showLineNumbers, showPlusMinusSymbols }) => {
  const lines = computeDiff(oldText, newText)
  const monoFont = Platform.select({ ios: 'IBM Plex Mono', default: 'monospace' })

  return (
    <ScrollView style={styles.container} horizontal={false}>
      {lines.map((line, idx) => {
        const symbol = showPlusMinusSymbols
          ? line.type === 'add'
            ? '+ '
            : line.type === 'remove'
              ? '- '
              : '  '
          : ''
        const lineNum = showLineNumbers
          ? line.type === 'add'
            ? `${line.newLine ?? ''}`
            : line.type === 'remove'
              ? `${line.oldLine ?? ''}`
              : `${line.oldLine ?? ''}`
          : null
        const color =
          line.type === 'add' ? theme.ok : line.type === 'remove' ? theme.error : theme.textDim
        const bg =
          line.type === 'add' ? 'rgba(111,207,142,0.08)' : line.type === 'remove' ? 'rgba(239,111,108,0.08)' : 'transparent'
        return (
          <View key={idx} style={[styles.line, { backgroundColor: bg }]}>
            {lineNum != null ? <Text style={[styles.lineNum, { fontFamily: monoFont }]}>{lineNum}</Text> : null}
            <Text style={[styles.text, { color, fontFamily: monoFont }]}>
              {symbol}
              {line.text}
            </Text>
          </View>
        )
      })}
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.ink,
    borderRadius: 6,
    padding: 8,
  },
  line: { flexDirection: 'row', paddingVertical: 1, paddingHorizontal: 4 },
  lineNum: { fontSize: 11, color: theme.textFaint, width: 32, textAlign: 'right', marginRight: 8 },
  text: { fontSize: 12, lineHeight: 16, flex: 1 },
})
