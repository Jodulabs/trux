import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { theme } from '../src/theme'
import { savePair, parsePairQr, getStoredToken } from '../src/ports'

// Web pairing fallback. There's no camera QR scan on web (expo-camera is
// native-only), and most web users arrive via a `#token=` URL captured by
// ports.web.ts at boot. This screen is the manual fallback: paste either the
// full `trux pair` URL or the bare token. On success it persists via the web
// Storage port (savePair) and the (app) gate redirects into the conversation
// list — the same success path as the native pair screen.
export default function PairWebScreen(): React.ReactElement {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const finish = (token: string): void => {
    // Web is same-origin — host is the page origin, so savePair only needs the token.
    savePair('', token)
    setError(null)
    router.replace('/')
  }

  const submit = (): void => {
    const raw = value.trim()
    if (!raw) {
      setError('Paste the URL from `trux pair`, or the token itself.')
      return
    }
    // Accept either a full pair URL (https://host/#token=…) or a bare token.
    const parsed = parsePairQr(raw)
    finish(parsed ? parsed.token : raw)
  }

  const alreadyPaired = Boolean(getStoredToken())

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.mark}>✳</Text>
        <Text style={styles.title}>Pair with a trux box</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.hint}>
          Run <Text style={styles.code}>trux pair</Text> on your box and paste the URL below — or just the token.
        </Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          placeholder="https://box.ts.net/#token=…"
          placeholderTextColor={theme.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={submit}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={styles.button} onPress={submit}>
          <Text style={styles.buttonText}>Save & connect</Text>
        </Pressable>
      </View>

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
  body: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
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
