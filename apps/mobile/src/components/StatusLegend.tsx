import { View, Text, StyleSheet } from 'react-native'
import { theme, STATUS_COLORS } from '../theme'

const ROWS: { key: keyof typeof STATUS_COLORS; label: string }[] = [
  { key: 'idle', label: 'Idle' },
  { key: 'thinking', label: 'Working' },
  { key: 'awaiting_approval', label: 'Needs your approval' },
  { key: 'error', label: 'Error' },
]

export function StatusLegend(): React.ReactElement {
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      {ROWS.map((r) => (
        <View key={r.key} style={styles.row}>
          <View
            style={[styles.dot, { backgroundColor: STATUS_COLORS[r.key] }]}
            accessibilityLabel={r.label}
          />
          <Text style={styles.label}>{r.label}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans },
})
