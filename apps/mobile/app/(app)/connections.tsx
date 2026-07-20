import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, TextInput, Linking, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import type { AgentCatalogEntry, AuthStatus as ProtocolAuthStatus } from '@trux/protocol'
import { authApi } from '@trux/client/auth'
import { api } from '@trux/client/api'
import { theme } from '../../src/theme'
import { haptic } from '../../src/haptics'

export default function ConnectionsScreen(): React.ReactElement {
  const router = useRouter()
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([])
  const [status, setStatus] = useState<Record<string, ProtocolAuthStatus>>({})
  const [device, setDevice] = useState<{ verifyUrl: string; userCode: string | null; needsCode?: boolean } | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load the catalog snapshot on mount; seed per-agent status from accounts.
  useEffect(() => {
    api.getCatalog().then((r) => {
      setCatalog(r.catalog ?? [])
      const st: Record<string, ProtocolAuthStatus> = {}
      for (const e of r.catalog ?? []) {
        // One account per agent today; its status is the agent's connection state.
        st[e.agent] = e.accounts[0]?.status ?? 'disconnected'
      }
      setStatus(st)
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
      if (mode.mode === 'device') { setDevice({ verifyUrl: mode.verifyUrl, userCode: mode.userCode, needsCode: mode.needsCode }); setHint(null) }
      else { setHint(mode.label); setDevice(null) } // apikey mode: prompt the key field
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

  const submitCode = async (id: string): Promise<void> => {
    haptic('medium')
    setBusy(true); setError(null)
    try {
      const { status: s } = await authApi.submitCode(id, codeInput)
      setStatus((prev) => ({ ...prev, [id]: s })); setCodeInput('')
      if (s === 'connected') { haptic('success'); setDevice(null); setActive(null) }
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
        {catalog.map((e) => {
          // Agents without authenticators (e.g. Pi) have no accounts to connect
          // here — they use their own native credentials. Skip them.
          if (e.accounts.length === 0) return null
          const id = e.agent
          return (
            <View key={id} style={styles.card}>
              <View style={styles.row}>
                <Text style={styles.provider}>{id}</Text>
                <Text style={styles.status}>{status[id] ?? '…'}</Text>
              </View>
              <View style={styles.actionRow}>
                <Pressable disabled={busy} onPress={() => connect(id)} style={styles.btn}>
                  <Text style={styles.btnText}>{status[id] === 'connected' ? 'Reconnect' : 'Connect'}</Text>
                </Pressable>
                {status[id] === 'connected' ? (
                  <Pressable onPress={() => disconnect(id)} style={styles.btnGhost}>
                    <Text style={styles.btnGhostText}>Disconnect</Text>
                  </Pressable>
                ) : null}
              </View>
              {active === id && device ? (
                <View style={styles.device}>
                  <Text style={styles.deviceLabel}>Open this URL and sign in:</Text>
                  <Pressable onPress={() => Linking.openURL(device.verifyUrl)}>
                    <Text style={styles.link}>{device.verifyUrl}</Text>
                  </Pressable>
                  {device.userCode ? <Text style={styles.code}>code: {device.userCode}</Text> : null}
                  {device.needsCode ? (
                    <View style={styles.keyRow}>
                      <TextInput
                        style={styles.input}
                        value={codeInput}
                        onChangeText={setCodeInput}
                        placeholder="paste the code shown after sign-in"
                        placeholderTextColor={theme.textFaint}
                        autoCapitalize="none"
                      />
                      <Pressable disabled={busy || !codeInput} onPress={() => submitCode(id)} style={styles.btn}>
                        <Text style={styles.btnText}>Submit</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {active === id && hint ? <Text style={styles.deviceLabel}>{hint} — paste it below.</Text> : null}
              <View style={styles.keyRow}>
                <TextInput
                  style={styles.input}
                  value={active === id ? keyInput : ''}
                  onFocus={() => setActive(id)}
                  onChangeText={setKeyInput}
                  placeholder="…or paste an API key"
                  placeholderTextColor={theme.textFaint}
                  autoCapitalize="none"
                  secureTextEntry
                />
                <Pressable disabled={busy || !keyInput} onPress={() => submitKey(id)} style={styles.btn}>
                  <Text style={styles.btnText}>Save</Text>
                </Pressable>
              </View>
            </View>
          )
        })}
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
