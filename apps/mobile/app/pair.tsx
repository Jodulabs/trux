import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { theme } from '../src/theme'
import { QrScanner } from '../src/components/QrScanner'
import { savePair, parsePairQr, getStoredHost, getStoredToken } from '../src/ports'

type Mode = 'scan' | 'paste'

// Phase A3 pair screen: the camera scanner is primary (the net-new native
// reality — no URL fragment to read), with a manual-paste fallback for when
// the camera is unavailable or the user prefers typing. A successful parse
// saves host+token via the Storage port (secure-store backed) and rebinds
// ServerConfig, then the (app) gate redirects into the conversation list.
export default function PairScreen(): React.ReactElement {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('scan')
  const [pasteValue, setPasteValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [scanReject, setScanReject] = useState<string | null>(null)

  const finish = (host: string, token: string): void => {
    savePair(host, token)
    setError(null)
    setScanReject(null)
    // (app) layout's gate re-checks host+token on next mount and redirects in.
    router.replace('/')
  }

  const onScanned = (payload: string): void => {
    const parsed = parsePairQr(payload)
    if (!parsed) {
      setScanReject('That QR isn’t a trux pair URL. Scan the QR from `trux pair`.')
      return
    }
    finish(parsed.host, parsed.token)
  }

  const submitPaste = (): void => {
    const parsed = parsePairQr(pasteValue.trim())
    if (!parsed) {
      setError('Paste the URL from `trux pair` (looks like https://<host>.ts.net/#token=…)')
      return
    }
    finish(parsed.host, parsed.token)
  }

  const alreadyPaired = Boolean(getStoredHost() && getStoredToken())

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.mark}>✳</Text>
        <Text style={styles.title}>Pair with a trux box</Text>
      </View>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, mode === 'scan' && styles.tabActive]} onPress={() => { setMode('scan'); setError(null) }}>
          <Text style={[styles.tabText, mode === 'scan' && styles.tabTextActive]}>Scan QR</Text>
        </Pressable>
        <Pressable style={[styles.tab, mode === 'paste' && styles.tabActive]} onPress={() => { setMode('paste'); setScanReject(null) }}>
          <Text style={[styles.tabText, mode === 'paste' && styles.tabTextActive]}>Paste URL</Text>
        </Pressable>
      </View>

      {mode === 'scan' ? (
        <View style={styles.scanBody}>
          <QrScanner onScanned={onScanned} paused={false} />
          {scanReject ? <Text style={styles.scanReject}>{scanReject}</Text> : null}
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.pasteBody}
        >
          <Text style={styles.hint}>
            On this box, run <Text style={styles.code}>trux pair</Text> and paste the URL below.
          </Text>
          <TextInput
            style={styles.input}
            value={pasteValue}
            onChangeText={setPasteValue}
            placeholder="https://box.ts.net/#token=…"
            placeholderTextColor={theme.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onSubmitEditing={submitPaste}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={submitPaste}>
            <Text style={styles.buttonText}>Save & connect</Text>
          </Pressable>
        </KeyboardAvoidingView>
      )}

      {alreadyPaired ? (
        <Pressable style={styles.skip} onPress={() => router.replace('/')}>
          <Text style={styles.skipText}>Already paired — go to conversations</Text>
        </Pressable>
      ) : null}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
  mark: { color: theme.accent, fontSize: 22, fontFamily: theme.fontMono },
  title: { color: theme.text, fontSize: 20, fontFamily: `${theme.fontSans}-600` },
  tabs: { flexDirection: 'row', paddingHorizontal: 24, gap: 8, marginBottom: 12 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: theme.radiusSm, borderWidth: 1, borderColor: theme.line },
  tabActive: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  tabText: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
  tabTextActive: { color: theme.accentBright, fontFamily: `${theme.fontSans}-600` },
  scanBody: { flex: 1, paddingHorizontal: 24, paddingBottom: 16, gap: 12 },
  scanReject: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono, textAlign: 'center' },
  pasteBody: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  hint: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans, lineHeight: 20 },
  code: { color: theme.accentBright, fontFamily: theme.fontMono },
  input: {
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontMono,
  },
  button: { backgroundColor: theme.accent, borderRadius: theme.radius, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: theme.ink, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
  error: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  skip: { alignSelf: 'center', padding: 12, marginBottom: 8 },
  skipText: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
})
