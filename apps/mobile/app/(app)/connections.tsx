import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, TextInput, Linking, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { authApi, type AuthStatus, type ProviderInfo } from '@trux/client/auth'
import { theme } from '../../src/theme'
import { haptic } from '../../src/haptics'

export default function ConnectionsScreen(): React.ReactElement {
  const router = useRouter()
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [status, setStatus] = useState<Record<string, AuthStatus>>({})
  const [device, setDevice] = useState<{ verifyUrl: string; userCode: string | null } | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load providers + their current status on mount.
  useEffect(() => {
    authApi.providers().then(async (ps) => {
      setProviders(ps)
      const entries = await Promise.all(ps.map(async (p) => [p.id, (await authApi.status(p.id)).status] as const))
      setStatus(Object.fromEntries(entries))
    }).catch((e) => setError(String(e)))
  }, [])

  // While a device login is showing, poll until it leaves 'pending'.
  useEffect(() => {
    if (!active || !device) return
    const t = setInterval(async () => {
      const { status: s } = await authApi.poll(active)
      if (s !== 'pending') {
        setStatus((prev) => ({ ...prev, [active]: s }))
        if (s === 'connected') { haptic('success'); setDevice(null); setActive(null) }
      }
    }, 2000)
    return () => clearInterval(t)
  }, [active, device])

  const connect = async (id: string): Promise<void> => {
    if (status[id] === 'connected' && !confirmReauth()) return
    haptic('medium')
    setBusy(true); setError(null); setActive(id)
    try {
      const mode = await authApi.begin(id)
      if (mode.mode === 'device') setDevice({ verifyUrl: mode.verifyUrl, userCode: mode.userCode })
    } catch (e) { setError(String(e)); setActive(null) } finally { setBusy(false) }
  }

  const submitKey = async (id: string): Promise<void> => {
    haptic('medium')
    setBusy(true); setError(null)
    try {
      const { status: s } = await authApi.submitKey(id, keyInput)
      setStatus((prev) => ({ ...prev, [id]: s })); setKeyInput('')
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  const disconnect = async (id: string): Promise<void> => {
    haptic('medium')
    await authApi.disconnect(id)
    setStatus((prev) => ({ ...prev, [id]: 'disconnected' }))
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Connections</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {providers.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.provider}>{p.id}</Text>
              <Text style={styles.status}>{status[p.id] ?? '…'}</Text>
            </View>
            <View style={styles.actionRow}>
              <Pressable disabled={busy} onPress={() => connect(p.id)} style={styles.btn}>
                <Text style={styles.btnText}>{status[p.id] === 'connected' ? 'Reconnect' : 'Connect'}</Text>
              </Pressable>
              {status[p.id] === 'connected' ? (
                <Pressable onPress={() => disconnect(p.id)} style={styles.btnGhost}>
                  <Text style={styles.btnGhostText}>Disconnect</Text>
                </Pressable>
              ) : null}
            </View>
            {active === p.id && device ? (
              <View style={styles.device}>
                <Text style={styles.deviceLabel}>Open this URL on any device and sign in:</Text>
                <Pressable onPress={() => Linking.openURL(device.verifyUrl)}>
                  <Text style={styles.link}>{device.verifyUrl}</Text>
                </Pressable>
                {device.userCode ? <Text style={styles.code}>code: {device.userCode}</Text> : null}
              </View>
            ) : null}
            <View style={styles.keyRow}>
              <TextInput
                style={styles.input}
                value={active === p.id ? keyInput : ''}
                onFocus={() => setActive(p.id)}
                onChangeText={setKeyInput}
                placeholder="…or paste an API key"
                placeholderTextColor={theme.textFaint}
                autoCapitalize="none"
                secureTextEntry
              />
              <Pressable disabled={busy || !keyInput} onPress={() => submitKey(p.id)} style={styles.btn}>
                <Text style={styles.btnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}

// Native confirm is async; for the lean cut, allow re-auth (the CLI clears the
// old session anyway). Replace with a real Alert.alert confirm if desired.
function confirmReauth(): boolean { return true }

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
  body: { padding: 20, gap: 16 },
  error: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  card: { backgroundColor: theme.surface1, borderRadius: theme.radius, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  provider: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-600`, textTransform: 'capitalize' },
  status: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontMono },
  btn: { backgroundColor: theme.accent, borderRadius: theme.radiusSm, paddingHorizontal: 14, paddingVertical: 9 },
  btnText: { color: theme.ink, fontFamily: `${theme.fontSans}-600`, fontSize: 14 },
  btnGhost: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  btnGhostText: { color: theme.textDim, fontFamily: `${theme.fontSans}-600`, fontSize: 14 },
  device: { backgroundColor: theme.ink, borderRadius: theme.radiusSm, padding: 12, gap: 6 },
  deviceLabel: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans },
  link: { color: theme.accentBright, textDecorationLine: 'underline', fontFamily: theme.fontMono, fontSize: 13 },
  code: { color: theme.text, fontSize: 18, fontFamily: theme.fontMono, letterSpacing: 2 },
  keyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: theme.ink,
    borderWidth: 1,
    borderColor: theme.line,
    color: theme.text,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontFamily: theme.fontMono,
    fontSize: 13,
  },
})
