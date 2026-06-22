import { View, Text, Pressable, StyleSheet, Modal } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { previewUrl } from '@trux/client/preview'
import { theme } from '../theme'

interface Props {
  conversationId?: string
  port: number
  visible: boolean
  onClose: () => void
}

// Web preview pane (react-native-web). Hosts the agent's dev server — proxied
// through trux's authenticated origin at /__preview__/<port>/ (token in query →
// cookie) — in an <iframe src>. Mirrors TerminalPane.web's full-screen Modal.
export function PreviewPane({ port, visible, onClose }: Props): React.ReactElement {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Preview :{port}</Text>
          <View style={styles.headerSpacer} />
          <Pressable hitSlop={12} onPress={onClose} accessibilityLabel="Close preview">
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>
        <View style={styles.web}>
          {visible ? (
            // react-native-web passes unknown DOM props through; an iframe is
            // valid here and loads the proxied dev-server URL directly.
            <iframe
              src={previewUrl(port)}
              title={`Preview ${port}`}
              style={{ border: 'none', width: '100%', height: '100%', background: theme.ink }}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
  headerSpacer: { flex: 1 },
  close: { color: theme.textDim, fontSize: 18, fontFamily: theme.fontSans },
  web: { flex: 1, backgroundColor: theme.ink },
})
