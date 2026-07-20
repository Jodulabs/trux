import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { theme } from '../../src/theme'
import { getStoredHost, getStoredToken, clearPair } from '../../src/ports'
import { haptic } from '../../src/haptics'
import { confirmAsync } from '../../src/confirm'
import { IconButton } from '../../src/icons'
import { StatusLegend } from '../../src/components/StatusLegend'

export default function SettingsScreen(): React.ReactElement {
  const router = useRouter()
  const host = getStoredHost()
  const token = getStoredToken()
  const tokenDisplay = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : 'none'

  const switchHost = async (): Promise<void> => {
    const ok = await confirmAsync(
      'Switch host?',
      'This clears the paired token on this device. You will need to scan or paste a new pair URL.',
      'Switch host',
    )
    if (!ok) return
    clearPair()
    haptic('medium')
    router.replace('/pair')
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <IconButton name="chevron-back" accessibilityLabel="Back" onPress={() => router.back()} color={theme.accent} />
        <Text style={styles.title}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Agents</Text>
          <Pressable
            style={({ pressed }) => [styles.linkRow, pressed && styles.linkPressed]}
            onPress={() => router.push('/providers')}
            accessibilityRole="button"
            accessibilityLabel="Manage providers"
          >
            <Text style={styles.linkLabel}>Providers & accounts</Text>
            <Text style={styles.linkChevron}>›</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status dots</Text>
          <View style={styles.legendBox}>
            <StatusLegend />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <Text style={styles.hint}>
            Push alerts for approvals and turn complete are privacy-sensitive: lock-screen previews can leak command text. Prefer generic titles on a shared device.
          </Text>
        </View>

        <Pressable
          style={({ pressed }) => [styles.switchBtn, pressed && styles.switchBtnPressed]}
          onPress={() => { void switchHost() }}
          accessibilityRole="button"
          accessibilityLabel="Switch host or re-pair"
        >
          <Text style={styles.switchBtnText}>Switch host / re-pair</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  body: { paddingHorizontal: 20, paddingVertical: 20, gap: 24 },
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
    minHeight: 48,
  },
  rowLabel: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
  rowValue: { color: theme.text, fontSize: 14, fontFamily: theme.fontMono, flexShrink: 1, textAlign: 'right' },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: theme.surface1,
    borderRadius: theme.radiusSm,
    minHeight: 48,
  },
  linkPressed: { backgroundColor: theme.surface2 },
  linkLabel: { color: theme.text, fontSize: 14, fontFamily: theme.fontSans },
  linkChevron: { color: theme.textFaint, fontSize: 18 },
  legendBox: {
    backgroundColor: theme.surface1,
    borderRadius: theme.radiusSm,
    padding: 14,
  },
  hint: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans, lineHeight: 19 },
  switchBtn: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: 'center',
    minHeight: 48,
  },
  switchBtnPressed: { backgroundColor: theme.surface3 },
  switchBtnText: { color: theme.accent, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
})
