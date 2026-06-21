import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { theme } from '../theme'
import { haptic } from '../haptics'

interface Props {
  busy: boolean
  onSend: (text: string) => void
  onInterrupt: () => void
}

// Phase A4 composer: auto-grow-ish single-line input with a send button that
// flips to interrupt while the agent is thinking. Keyboard avoidance is handled
// by the parent (the session screen wraps us in KeyboardAvoidingView) so the
// composer stays sticky above the keyboard. No model picker / commands yet —
// those land in Phase B/C with the control picker and command palette.
export function Composer({ busy, onSend, onInterrupt }: Props): React.ReactElement {
  const [text, setText] = useState('')

  const submit = (): void => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    onSend(trimmed)
    setText('')
    haptic('light')
  }

  return (
    <View style={styles.shell}>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
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
  )
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: theme.lineSoft,
    backgroundColor: theme.ink,
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
})
