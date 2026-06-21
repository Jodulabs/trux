import { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { AgentCapabilities, TurnConfig } from '@trux/protocol'
import { theme } from '../theme'
import { haptic } from '../haptics'

interface Props {
  caps: AgentCapabilities
  value: TurnConfig
  onChange: (next: TurnConfig) => void
}

// Native control picker: model + opaque controls rendered as chip rows.
// A leading "default" chip means "no override" — trux does not pick.
// Mirrors the PWA's ControlPicker but uses chip selectors instead of <select>
// dropdowns, which are awkward on native.
export function ControlPicker({ caps, value, onChange }: Props) {
  const [expanded, setExpanded] = useState(false)

  const setModel = (model: string): void => {
    onChange({ ...value, model: model || null })
    haptic('light')
  }
  const setOption = (key: string, v: string): void => {
    const options = { ...value.options }
    if (v) options[key] = v
    else delete options[key]
    onChange({ ...value, options })
    haptic('light')
  }

  const hasModel = caps.models.length > 0
  const hasControls = caps.controls.length > 0
  if (!hasModel && !hasControls) return null

  // Summary line when collapsed
  const modelLabel = value.model ? caps.models.find((m) => m.value === value.model)?.label ?? value.model : 'default'
  const controlLabels = caps.controls.filter((c) => value.options[c.key]).map((c) => `${c.label}: ${value.options[c.key]}`)
  const summary = [modelLabel, ...controlLabels].join(' · ')

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.toggle} onPress={() => setExpanded(!expanded)}>
        <Text style={styles.toggleText} numberOfLines={1}>{summary}</Text>
        <Text style={styles.chevron}>{expanded ? '▴' : '▾'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.pickerBody}>
          {hasModel ? (
            <View style={styles.pickerSection}>
              <Text style={styles.pickerLabel}>Model</Text>
              <View style={styles.chipRow}>
                <Chip label="default" selected={!value.model} onPress={() => setModel('')} />
                {caps.models.map((m) => (
                  <Chip key={m.value} label={m.label} selected={value.model === m.value} onPress={() => setModel(m.value)} />
                ))}
              </View>
            </View>
          ) : null}
          {caps.controls.map((c) => (
            <View key={c.key} style={styles.pickerSection}>
              <Text style={styles.pickerLabel}>{c.label}</Text>
              <View style={styles.chipRow}>
                <Chip label="default" selected={!value.options[c.key]} onPress={() => setOption(c.key, '')} />
                {c.options.map((o) => (
                  <Chip key={o.value} label={o.label} selected={value.options[c.key] === o.value} onPress={() => setOption(c.key, o.value)} />
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && styles.chipPressed]}
      onPress={onPress}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderTopColor: theme.lineSoft, backgroundColor: theme.surface1 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  toggleText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono, flex: 1 },
  chevron: { color: theme.textFaint, fontSize: 10, marginLeft: 8 },
  pickerBody: { paddingHorizontal: 14, paddingBottom: 10, gap: 10 },
  pickerSection: { gap: 6 },
  pickerLabel: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
  },
  chipSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipPressed: { backgroundColor: theme.surface3 },
  chipText: { color: theme.text, fontSize: 12, fontFamily: theme.fontSans },
  chipTextSelected: { color: theme.ink, fontWeight: '600' },
})
