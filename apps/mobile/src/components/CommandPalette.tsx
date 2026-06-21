import { useMemo, useState } from 'react'
import { View, Text, TextInput, Pressable, ScrollView, Modal, StyleSheet } from 'react-native'
import type { AgentCommand } from '@trux/protocol'
import { resolveCommand } from '@trux/protocol'
import { getStorage } from '@trux/client/ports'
import { theme } from '../theme'
import { haptic } from '../haptics'

interface Props {
  agent: string
  commands: AgentCommand[]
  visible: boolean
  onPick: (text: string) => void
  onClose: () => void
}

// Command recents, persisted through the shared Storage port (same sync cache
// the spine uses). Best-effort — a parse failure just yields no recents.
const RECENTS_KEY = 'trux_cmd_recents'
function loadRecents(): string[] {
  try {
    return JSON.parse(getStorage().get(RECENTS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}
function pushRecent(name: string): void {
  const next = [name, ...loadRecents().filter((n) => n !== name)].slice(0, 8)
  try {
    getStorage().set(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // best-effort
  }
}

// Native command palette: a bottom sheet (the mobile-UX standard — never a
// desktop dropdown). Mirrors the PWA's CommandPalette — search, recents-first
// ordering, an arg form for parameterized commands — resolving the template and
// inserting it into the composer for review rather than auto-sending.
export function CommandPalette({ agent, commands, visible, onPick, onClose }: Props): React.ReactElement {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AgentCommand | null>(null)
  const [argv, setArgv] = useState<Record<string, string>>({})

  const filtered = useMemo(() => {
    const recents = loadRecents()
    const q = query.toLowerCase()
    return commands
      .filter((c) => c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
      .sort((a, b) => {
        const wa = recents.indexOf(a.name)
        const wb = recents.indexOf(b.name)
        return (wa === -1 ? Infinity : wa) - (wb === -1 ? Infinity : wb) || a.name.localeCompare(b.name)
      })
  }, [commands, query])

  const reset = (): void => {
    setQuery('')
    setSelected(null)
    setArgv({})
  }

  const close = (): void => {
    reset()
    onClose()
  }

  const run = (cmd: AgentCommand, values: Record<string, string>): void => {
    pushRecent(cmd.name)
    onPick(resolveCommand(cmd.body, values))
    haptic('light')
    reset()
    onClose()
  }

  const choose = (cmd: AgentCommand): void => {
    if (cmd.args.length === 0) run(cmd, {})
    else {
      setSelected(cmd)
      setArgv({})
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close commands" />
      <View style={styles.sheet}>
        {selected ? (
          <View style={styles.argForm}>
            <Text style={styles.argTitle}>/{selected.name}</Text>
            {selected.args.map((a, i) => (
              <View key={a.name} style={styles.argField}>
                <Text style={styles.argLabel}>{a.label}</Text>
                <TextInput
                  style={styles.argInput}
                  autoFocus={i === 0}
                  value={argv[a.name] ?? ''}
                  onChangeText={(v) => setArgv((p) => ({ ...p, [a.name]: v }))}
                  placeholderTextColor={theme.textFaint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel={a.label}
                />
              </View>
            ))}
            <Pressable style={styles.runBtn} onPress={() => run(selected, argv)}>
              <Text style={styles.runBtnText}>Insert</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.search}
              placeholder="Search commands…"
              placeholderTextColor={theme.textFaint}
              autoFocus
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.sectionLabel}>{agent} commands</Text>
            {filtered.length === 0 ? (
              <Text style={styles.empty}>No commands</Text>
            ) : (
              <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                {filtered.map((c) => (
                  <Pressable
                    key={c.name}
                    style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                    onPress={() => choose(c)}
                  >
                    <Text style={styles.itemName}>/{c.name}</Text>
                    {c.description ? <Text style={styles.itemDesc} numberOfLines={1}>{c.description}</Text> : null}
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </>
        )}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: theme.surface1,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  search: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontSans,
  },
  sectionLabel: {
    color: theme.textFaint,
    fontSize: 12,
    fontFamily: theme.fontMono,
    textTransform: 'uppercase',
    paddingVertical: 10,
  },
  empty: { color: theme.textDim, fontSize: 14, fontFamily: theme.fontSans, paddingVertical: 12 },
  list: { flexGrow: 0 },
  item: { paddingVertical: 12, gap: 2, borderRadius: theme.radiusSm, paddingHorizontal: 6 },
  itemPressed: { backgroundColor: theme.surface2 },
  itemName: { color: theme.accentBright, fontSize: 15, fontFamily: theme.fontMono },
  itemDesc: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans },
  argForm: { gap: 12 },
  argTitle: { color: theme.accentBright, fontSize: 16, fontFamily: theme.fontMono },
  argField: { gap: 6 },
  argLabel: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans },
  argInput: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 15,
    fontFamily: theme.fontSans,
  },
  runBtn: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  runBtnText: { color: theme.ink, fontSize: 15, fontFamily: `${theme.fontSans}-600` },
})
