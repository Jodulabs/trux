import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, StyleSheet, Pressable } from 'react-native'
import { useStore } from '@trux/client/store'
import { theme } from '../../../src/theme'

// Phase A2 session placeholder. A4 builds the full ConversationView + Composer
// + Transcript carrying the connection-state indicator; this just proves the
// route + param wiring and renders the loaded conversation header.
export default function SessionScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const conv = conversations.find((c) => c.id === id)

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{conv?.title ?? conv?.cwd?.split('/').pop() ?? id}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.placeholder}>Conversation surface lands in Phase A4.</Text>
        <Text style={styles.id}>session {id}</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 16, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500`, flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  placeholder: { color: theme.textDim, fontSize: 15, fontFamily: theme.fontSans, textAlign: 'center' },
  id: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono },
})
