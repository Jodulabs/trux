import { View, Text, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { theme } from '../../src/theme'
import { getStoredHost, getStoredToken, clearPair } from '../../src/ports'
import { haptic } from '../../src/haptics'

// Minimal settings: shows the current paired host, offers a "Switch host"
// button that clears the pair and navigates to the pair flow. No backend
// changes needed — all config is env-driven on the server side.
export default function SettingsScreen(): React.ReactElement {
  const router = useRouter()
  const host = getStoredHost()
  const token = getStoredToken()
  const tokenDisplay = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : 'none'

  const switchHost = (): void => {
    clearPair()
    haptic('medium')
    router.replace('/pair')
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Host</Text>
            <Text style={styles.rowValue} numberOfLines={1}>{host ?? 'not set'}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Token</Text>
            <Text style={styles.rowValue}>{tokenDisplay}</Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
          onPress={switchHost}
        >
          <Text style={styles.switchBtnText}>Switch host / re-pair</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  body: { flex: 1, paddingHorizontal: 20, paddingVertical: 20, gap: 20 },
  section: { gap: 2 },
  sectionTitle: {
    color: theme.textFaint,
    fontSize: 12,
    fontFamily: theme.fontMono,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: theme.surface1,
    borderRadius: theme.radiusSm,
    gap: 12,
  },
  rowLabel: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
  rowValue: { color: theme.text, fontSize: 14, fontFamily: theme.fontMono, flexShrink: 1, textAlign: 'right' },
  switchBtn: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: 'center',
  },
  switchBtnPressed: { backgroundColor: theme.surface3 },
  switchBtnText: { color: theme.accent, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
})
