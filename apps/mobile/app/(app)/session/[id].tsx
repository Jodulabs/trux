import { useLocalSearchParams, useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useStore } from '@trux/client/store'
import { theme } from '../../../src/theme'
import { ConversationView } from '../../../src/components/ConversationView'

// Phase A4 session screen: a back button + the loaded conversation title, then
// the ConversationView (transcript + composer + connection banner). The view
// owns its WS connection via the shared connectionManager.
export default function SessionScreen(): React.ReactElement {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const conversations = useStore((s) => s.conversations)
  const conv = conversations.find((c) => c.id === id)
  const title = conv?.title ?? conv?.cwd?.replace(/\/$/, '').split('/').pop() ?? id

  return (
    <SafeAreaView style={styles.shell} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <ConversationView id={id} onBack={() => router.back()} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.ink },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
  },
  back: { color: theme.accent, fontSize: 22, fontFamily: theme.fontSans },
  title: { color: theme.text, fontSize: 16, fontFamily: `${theme.fontSans}-500`, flex: 1 },
})
