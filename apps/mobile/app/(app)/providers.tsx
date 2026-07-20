import { useEffect, useState } from 'react'
import { View, Text, Pressable, TextInput, Linking, ScrollView, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import type { AgentCatalogEntry, AuthStatus as ProtocolAuthStatus } from '@trux/protocol'
import { authApi } from '@trux/client/auth'
import { api } from '@trux/client/api'
import { theme } from '../../src/theme'
import { haptic } from '../../src/haptics'
import { confirmAsync } from '../../src/confirm'

type DeviceFlow = {
  providerId: string
  verifyUrl: string
  userCode: string | null
  needsCode?: boolean
}

export default function ProvidersScreen(): React.ReactElement {
  const router = useRouter()
  const [catalog, setCatalog] = useState<AgentCatalogEntry[]>([])
  const [status, setStatus] = useState<Record<string, ProtocolAuthStatus>>({})
  const [device, setDevice] = useState<DeviceFlow | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [hint, setHint] = useState<{ providerId: string; label: string } | null>(null)
  const [keyFor, setKeyFor] = useState<string | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkNote, setLinkNote] = useState<string | null>(null)

  useEffect(() => {
    api.getCatalog().then((r) => {
      setCatalog(r.catalog ?? [])
      const st: Record<string, ProtocolAuthStatus> = {}
      for (const e of r.catalog ?? []) {
        st[e.agent] = e.accounts[0]?.status ?? 'disconnected'
      }
      setStatus(st)
    }).catch((e) => setError(String(e)))
  }, [])

  useEffect(() => {
    if (!device) return
    const providerId = device.providerId
    const t = setInterval(async () => {
      const { status: s } = await authApi.poll(providerId)
      if (s !== 'pending') {
        setStatus((prev) => ({ ...prev, [providerId]: s }))
        if (s === 'connected') {
          haptic('success')
          setDevice(null)
          setLinkNote(null)
        }
      }
    }, 2000)
    return () => clearInterval(t)
  }, [device])

  const openVerifyUrl = async (url: string): Promise<void> => {
    try {
      const supported = await Linking.canOpenURL(url)
      if (!supported) {
        setLinkNote('Couldn’t open this URL on this device — use Copy link.')
        return
      }
      await Linking.openURL(url)
      setLinkNote(null)
    } catch {
      setLinkNote('Couldn’t open this URL — use Copy link and paste it in a browser.')
    }
  }

  const copyVerifyUrl = async (url: string): Promise<void> => {
    await Clipboard.setStringAsync(url)
    haptic('light')
    setLinkNote('Link copied.')
  }

  const connect = async (id: string): Promise<void> => {
    if (status[id] === 'connected') {
      const ok = await confirmAsync(
        'Re-authenticate?',
        `Reconnect ${id}? This replaces the current session on the box.`,
        'Reconnect',
      )
      if (!ok) return
    }
    haptic('medium')
    setBusy(true)
    setError(null)
    setLinkNote(null)
    setHint(null)
    setDevice(null)
    try {
      const mode = await authApi.begin(id)
      if (mode.mode === 'device') {
        const next: DeviceFlow = {
          providerId: id,
          verifyUrl: mode.verifyUrl,
          userCode: mode.userCode,
          needsCode: mode.needsCode,
        }
        setDevice(next)
        void openVerifyUrl(mode.verifyUrl)
      } else {
        setHint({ providerId: id, label: mode.label })
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
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
      if (s === 'connected') { haptic('success'); setDevice(null); setLinkNote(null) }
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  const disconnect = async (id: string): Promise<void> => {
    haptic('medium')
    await authApi.disconnect(id)
    setStatus((prev) => ({ ...prev, [id]: 'disconnected' }))
    if (device?.providerId === id) setDevice(null)
  }

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title}>Providers</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {catalog.map((e) => {
          const id = e.agent
          const modelCount = e.capabilities.models.length
          const defaultModel = e.capabilities.defaultModel
          const isNative = e.accounts[0]?.kind === 'native'
          const st = status[id] ?? 'disconnected'
          const runnable = e.runnable
          const flow = device?.providerId === id ? device : null
          return (
            <View key={id} style={styles.card}>
              <View style={styles.cardHead}>
                <View style={styles.cardHeadLeft}>
                  <Text style={styles.provider}>{id}</Text>
                  {runnable ? (
                    <View style={styles.runnableBadge}><Text style={styles.runnableText}>ready</Text></View>
                  ) : null}
                </View>
                <Text style={[styles.status, st === 'connected' && styles.statusConnected]}>{st}</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Models</Text>
                <Text style={styles.metaValue}>{modelCount > 0 ? `${modelCount}${defaultModel ? ` · default ${defaultModel}` : ''}` : 'free-text (type any)'}</Text>
              </View>
              {e.diagnostics && e.diagnostics.length > 0 ? (
                <View style={styles.diagBox}>
                  {e.diagnostics.map((d) => (
                    <Text key={d.code} style={styles.diagText}>• {d.message}</Text>
                  ))}
                </View>
              ) : null}
              {isNative ? (
                <Text style={styles.deviceLabel}>
                  {st === 'connected'
                    ? 'Authenticated on the box — ready to use.'
                    : 'Set up credentials in the agent\'s own console on the desktop (e.g. /login), or via env vars.'}
                </Text>
              ) : (
                <>
                  <View style={styles.actionRow}>
                    <Pressable disabled={busy} onPress={() => void connect(id)} style={styles.btn}>
                      <Text style={styles.btnText}>{st === 'connected' ? 'Reconnect' : 'Connect'}</Text>
                    </Pressable>
                    {st === 'connected' ? (
                      <Pressable onPress={() => void disconnect(id)} style={styles.btnGhost}>
                        <Text style={styles.btnGhostText}>Disconnect</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {flow ? (
                    <View style={styles.device}>
                      <Text style={styles.deviceLabel}>Sign in for {id}:</Text>
                      <Text style={styles.link} selectable>{flow.verifyUrl}</Text>
                      <View style={styles.actionRow}>
                        <Pressable style={styles.btn} onPress={() => void openVerifyUrl(flow.verifyUrl)}>
                          <Text style={styles.btnText}>Open browser</Text>
                        </Pressable>
                        <Pressable style={styles.btnGhost} onPress={() => void copyVerifyUrl(flow.verifyUrl)}>
                          <Text style={styles.btnGhostText}>Copy link</Text>
                        </Pressable>
                      </View>
                      {linkNote && device?.providerId === id ? (
                        <Text style={styles.note}>{linkNote}</Text>
                      ) : null}
                      {flow.userCode ? <Text style={styles.code}>code: {flow.userCode}</Text> : null}
                      {flow.needsCode ? (
                        <View style={styles.keyRow}>
                          <TextInput
                            style={styles.input}
                            value={codeInput}
                            onChangeText={setCodeInput}
                            placeholder="paste the code shown after sign-in"
                            placeholderTextColor={theme.textFaint}
                            autoCapitalize="none"
                          />
                          <Pressable disabled={busy || !codeInput} onPress={() => void submitCode(id)} style={styles.btn}>
                            <Text style={styles.btnText}>Submit</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                  {hint?.providerId === id ? (
                    <Text style={styles.deviceLabel}>{hint.label} — paste it below.</Text>
                  ) : null}
                  <View style={styles.keyRow}>
                    <TextInput
                      style={styles.input}
                      value={keyFor === id ? keyInput : ''}
                      onFocus={() => setKeyFor(id)}
                      onChangeText={setKeyInput}
                      placeholder="…or paste an API key"
                      placeholderTextColor={theme.textFaint}
                      autoCapitalize="none"
                      secureTextEntry
                    />
                    <Pressable disabled={busy || !keyInput || keyFor !== id} onPress={() => void submitKey(id)} style={styles.btn}>
                      <Text style={styles.btnText}>Save</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          )
        })}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500` },
  body: { padding: 20, gap: 16 },
  error: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  note: { color: theme.warn, fontSize: 12, fontFamily: theme.fontSans },
  card: { backgroundColor: theme.surface1, borderRadius: theme.radius, padding: 16, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  provider: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-600`, textTransform: 'capitalize' },
  runnableBadge: {
    backgroundColor: theme.accentSoft,
    borderWidth: 1, borderColor: theme.accent,
    borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1,
  },
  runnableText: { color: theme.accentBright, fontSize: 10, fontFamily: theme.fontMono },
  status: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontMono },
  statusConnected: { color: theme.ok },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaLabel: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, textTransform: 'uppercase' },
  metaValue: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontSans },
  diagBox: { gap: 2 },
  diagText: { color: theme.warn, fontSize: 12, fontFamily: theme.fontSans },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  btn: { backgroundColor: theme.accentBright, borderRadius: theme.radiusSm, paddingHorizontal: 14, paddingVertical: 9 },
  btnText: { color: theme.ink, fontFamily: `${theme.fontSans}-600`, fontSize: 14 },
  btnGhost: {
    backgroundColor: theme.surface2,
    borderWidth: 1, borderColor: theme.line,
    borderRadius: theme.radiusSm, paddingHorizontal: 14, paddingVertical: 9,
  },
  btnGhostText: { color: theme.textDim, fontFamily: `${theme.fontSans}-600`, fontSize: 14 },
  device: { backgroundColor: theme.ink, borderRadius: theme.radiusSm, padding: 12, gap: 8 },
  deviceLabel: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans },
  link: { color: theme.accentBright, fontFamily: theme.fontMono, fontSize: 12 },
  code: { color: theme.text, fontSize: 18, fontFamily: theme.fontMono, letterSpacing: 2 },
  keyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: theme.ink,
    borderWidth: 1, borderColor: theme.line,
    color: theme.text, borderRadius: theme.radiusSm,
    paddingHorizontal: 12, paddingVertical: 9,
    fontFamily: theme.fontMono, fontSize: 13,
  },
})
