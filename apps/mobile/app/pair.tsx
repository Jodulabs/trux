import { useState } from 'react'
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { theme } from '../src/theme'
import { savePair, parsePairQr, getStoredHost, getStoredToken } from '../src/ports'

// Phase A2 pair screen: manual paste of the trux pair URL. A3 adds the QR
// camera scanner (expo-camera); this text path stays as the fallback and is
// the first thing that works end-to-end on a fresh dev build.
export default function PairScreen(): React.ReactElement {
  const router = useRouter()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    const parsed = parsePairQr(value.trim())
    if (!parsed) {
      setError('Paste the URL from `trux pair` (looks like https://<host>.ts.net/#token=…)')
      return
    }
    savePair(parsed.host, parsed.token)
    setError(null)
    // (app) layout's gate re-checks host+token on next mount and redirects in.
    router.replace('/')
  }

  const alreadyPaired = Boolean(getStoredHost() && getStoredToken())

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.body}
      >
        <View style={styles.markRow}>
          <Text style={styles.mark}>✳</Text>
          <Text style={styles.title}>Pair with a trux box</Text>
        </View>
        <Text style={styles.hint}>
          On this box, run <Text style={styles.code}>trux pair</Text> and paste the URL below.
          The camera scanner arrives in Phase A3.
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
        {alreadyPaired ? (
          <Pressable style={styles.skip} onPress={() => router.replace('/')}>
            <Text style={styles.skipText}>Already paired — go to conversations</Text>
          </Pressable>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  body: { flex: 1, padding: 24, gap: 16, justifyContent: 'center' },
  markRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  mark: { color: theme.accent, fontSize: 24, fontFamily: theme.fontMono },
  title: { color: theme.text, fontSize: 22, fontFamily: `${theme.fontSans}-600` },
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
  button: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonText: { color: theme.ink, fontSize: 16, fontFamily: `${theme.fontSans}-600` },
  error: { color: theme.error, fontSize: 13, fontFamily: theme.fontMono },
  skip: { alignSelf: 'center', padding: 8 },
  skipText: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans },
})
