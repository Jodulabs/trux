import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import type { AgentCapabilities, AgentCommand, TurnConfig } from '@trux/protocol'
import { theme } from '../theme'
import { haptic } from '../haptics'
import { ControlPicker } from './ControlPicker'
import { CommandPalette } from './CommandPalette'

interface Props {
  busy: boolean
  onSend: (text: string, config?: TurnConfig) => void
  onInterrupt: () => void
  caps?: AgentCapabilities
  config?: TurnConfig
  onConfigChange?: (next: TurnConfig) => void
  commands?: AgentCommand[]
}

// Native composer: auto-grow-ish input with send/interrupt. Optional
// ControlPicker (model/effort) renders above the input when the agent exposes
// controls. A "/" button (and typing a lone "/") opens the CommandPalette
// bottom sheet. Keyboard avoidance is handled by the parent.
export function Composer({ busy, onSend, onInterrupt, caps, config, onConfigChange, commands }: Props): React.ReactElement {
  const [text, setText] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const hasControls = !!(caps && config && onConfigChange && (caps.models.length > 0 || caps.controls.length > 0))
  const hasCommands = !!(commands && commands.length > 0)

  const onChangeText = (val: string): void => {
    // Typing a lone "/" into an empty composer opens the palette (mirrors PWA).
    if (val === '/' && hasCommands) {
      setText('')
      setPaletteOpen(true)
      return
    }
    setText(val)
  }

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed, config)
    setText('')
    haptic('light')
  }

  return (
    <View style={styles.shell}>
      {hasControls && caps && config && onConfigChange ? (
        <ControlPicker caps={caps} value={config} onChange={onConfigChange} />
      ) : null}
      <View style={styles.inputRow}>
        {hasCommands ? (
          <Pressable
            style={styles.slashBtn}
            onPress={() => { setPaletteOpen(true); haptic('light') }}
            hitSlop={8}
            accessibilityLabel="Open commands"
          >
            <Text style={styles.slashText}>/</Text>
          </Pressable>
        ) : null}
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={onChangeText}
          placeholder="Message trux…"
          placeholderTextColor={theme.textFaint}
          multiline
          editable={!busy}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={submit}
        />
        {busy ? (
          <Pressable style={styles.interruptBtn} onPress={() => { onInterrupt(); haptic('medium') }} hitSlop={8}>
            <Text style={styles.interruptText}>■</Text>
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [styles.sendBtn, pressed && styles.sendBtnPressed, !text.trim() && styles.sendBtnDisabled]}
            onPress={submit}
            disabled={!text.trim()}
            hitSlop={8}
          >
            <Text style={styles.sendMark}>↑</Text>
          </Pressable>
        )}
      </View>
      {hasCommands && caps ? (
        <CommandPalette
          agent={caps.agent}
          commands={commands ?? []}
          visible={paletteOpen}
          onPick={(resolved) => setText(resolved)}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shell: {
    borderTopWidth: 1,
    borderTopColor: theme.lineSoft,
    backgroundColor: theme.ink,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  input: {
    flex: 1,
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontSans,
    maxHeight: 120,
    minHeight: 44,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: theme.radius,
    backgroundColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnPressed: { backgroundColor: theme.accentBright },
  sendBtnDisabled: { backgroundColor: theme.surface3 },
  sendMark: { color: theme.ink, fontSize: 18, fontFamily: `${theme.fontSans}-600` },
  interruptBtn: {
    width: 44,
    height: 44,
    borderRadius: theme.radius,
    backgroundColor: theme.surface3,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  interruptText: { color: theme.text, fontSize: 14, fontFamily: theme.fontMono },
  slashBtn: {
    width: 36,
    height: 44,
    borderRadius: theme.radius,
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slashText: { color: theme.accentBright, fontSize: 18, fontFamily: theme.fontMono },
})
