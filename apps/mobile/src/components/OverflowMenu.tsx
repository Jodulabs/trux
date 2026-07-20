import { Modal, Pressable, Text, View, StyleSheet } from 'react-native'
import { theme } from '../theme'

export interface OverflowAction {
  label: string
  onPress: () => void
}

interface Props {
  visible: boolean
  onClose: () => void
  actions: OverflowAction[]
}

/** Simple bottom sheet with labeled actions — replaces mystery header icon clusters. */
export function OverflowMenu({ visible, onClose, actions }: Props): React.ReactElement {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss menu">
        <View style={styles.sheet} onStartShouldSetResponder={() => true}>
          {actions.map((a) => (
            <Pressable
              key={a.label}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              onPress={() => {
                onClose()
                a.onPress()
              }}
              accessibilityRole="button"
              accessibilityLabel={a.label}
            >
              <Text style={styles.rowText}>{a.label}</Text>
            </Pressable>
          ))}
          <Pressable
            style={({ pressed }) => [styles.row, styles.cancel, pressed && styles.rowPressed]}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.surface1,
    borderTopLeftRadius: theme.radiusLg,
    borderTopRightRadius: theme.radiusLg,
    paddingBottom: 28,
    paddingTop: 8,
    borderTopWidth: 1,
    borderColor: theme.line,
  },
  row: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  rowPressed: { backgroundColor: theme.surface2 },
  rowText: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  cancel: { borderTopWidth: 1, borderTopColor: theme.lineSoft, marginTop: 4 },
  cancelText: { color: theme.textDim, fontSize: 16, fontFamily: theme.fontSans },
})
