import { useState } from 'react'
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ScrollView } from 'react-native'
import type { AgentCapabilities, TurnConfig, TurnTrust } from '@trux/protocol'
import { theme } from '../theme'
import { haptic } from '../haptics'
import { IconButton } from '../icons'

interface Props {
  caps: AgentCapabilities
  value: TurnConfig
  onChange: (next: TurnConfig) => void
}

export function ControlPicker({ caps, value, onChange }: Props) {
  const [open, setOpen] = useState(false)

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
  const setTrust = (trust: TurnTrust): void => {
    onChange({ ...value, trust })
    haptic('light')
  }

  const hasModels = caps.models.length > 0
  const allowAll = value.trust === 'allow_all'
  const modelLabel = value.model
    ? (hasModels ? caps.models.find((m) => m.value === value.model)?.label ?? value.model : value.model)
    : 'default'
  const controlLabels = caps.controls.filter((c) => value.options[c.key]).map((c) => `${c.label}: ${value.options[c.key]}`)
  const permLabel = allowAll ? 'allow all' : 'ask'
  const summary = [modelLabel, ...controlLabels, permLabel].join(' · ')

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.toggle}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Model and permissions: ${summary}`}
      >
        <Text style={styles.toggleText} numberOfLines={1}>{summary}</Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityLabel="Close controls" />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Turn controls</Text>
            <IconButton name="close" accessibilityLabel="Close" onPress={() => setOpen(false)} color={theme.textDim} />
          </View>
          <ScrollView contentContainerStyle={styles.pickerBody}>
            <View style={styles.pickerSection}>
              <Text style={styles.pickerLabel}>Model</Text>
              {hasModels ? (
                <View style={styles.chipRow}>
                  <Chip label="default" selected={!value.model} onPress={() => setModel('')} />
                  {caps.models.map((m) => (
                    <Chip key={m.value} label={m.label} selected={value.model === m.value} onPress={() => setModel(m.value)} />
                  ))}
                </View>
              ) : (
                <View style={styles.freeTextRow}>
                  <Chip label="default" selected={!value.model} onPress={() => setModel('')} />
                  <TextInput
                    style={styles.freeTextInput}
                    value={value.model ?? ''}
                    onChangeText={setModel}
                    placeholder="model id…"
                    placeholderTextColor={theme.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="Model id"
                  />
                </View>
              )}
            </View>
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
            <View style={styles.pickerSection}>
              <Text style={styles.pickerLabel}>Permissions</Text>
              <View style={styles.chipRow}>
                <Chip label="Ask per tool" selected={!allowAll} onPress={() => setTrust('ask')} />
                <Chip label="Allow all" selected={allowAll} onPress={() => setTrust('allow_all')} />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  )
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && !selected && styles.chipPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
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
    paddingVertical: 10,
    minHeight: 44,
  },
  toggleText: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono, flex: 1 },
  chevron: { color: theme.textFaint, fontSize: 10, marginLeft: 8 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: theme.surface1,
    borderTopLeftRadius: theme.radiusLg,
    borderTopRightRadius: theme.radiusLg,
    maxHeight: '70%',
    borderTopWidth: 1,
    borderColor: theme.line,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  sheetTitle: { color: theme.text, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
  pickerBody: { paddingHorizontal: 14, paddingBottom: 24, paddingTop: 10, gap: 14 },
  pickerSection: { gap: 6 },
  pickerLabel: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    borderRadius: theme.radiusSm,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipPressed: { backgroundColor: theme.surface3 },
  chipText: { color: theme.text, fontSize: 13, fontFamily: theme.fontSans },
  chipTextSelected: { color: theme.ink, fontWeight: '600' },
  freeTextRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  freeTextInput: {
    flex: 1,
    minWidth: 120,
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 10,
    paddingVertical: 10,
    color: theme.text,
    fontSize: 13,
    fontFamily: theme.fontMono,
    minHeight: 44,
  },
})
