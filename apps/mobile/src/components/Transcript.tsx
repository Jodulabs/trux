import { useEffect, useRef } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
import type { TranscriptItem } from '@trux/client/store'
import { toolSummary } from '@trux/client/tools'
import { theme } from '../theme'

interface Props {
  items: TranscriptItem[]
  status: string
}

interface Row {
  key: string
  kind: 'user' | 'assistant' | 'tool' | 'approval'
  text: string
  sub?: string
}

// Phase A4 plain-text transcript. Renders user_text, assistant text, and a
// compact one-line summary for tool_call/tool_result (rich tool-cards land in
// Phase B via the happy toolView graft). Approval requests show the tool name +
// subject so a blocking decision is visible even without the full ApprovalCard.
function toRows(items: TranscriptItem[]): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.type === 'user_text') {
      rows.push({ key: `u${i}`, kind: 'user', text: it.text })
    } else if (it.type === 'text') {
      rows.push({ key: `t${i}`, kind: 'assistant', text: it.text })
    } else if (it.type === 'tool_call') {
      rows.push({ key: `c${i}`, kind: 'tool', text: it.name, sub: toolSummary(it.name, it.input) })
    } else if (it.type === 'tool_result') {
      // Collapse a result into its call's row when they're adjacent; otherwise
      // show a standalone result line with the status.
      const prev = rows[rows.length - 1]
      if (prev && prev.kind === 'tool' && prev.sub != null) {
        prev.sub = `${prev.sub} · ${it.status}`
      } else {
        rows.push({ key: `r${i}`, kind: 'tool', text: 'result', sub: it.status })
      }
    } else if (it.type === 'approval_request') {
      rows.push({ key: `a${i}`, kind: 'approval', text: it.tool, sub: toolSummary(it.tool, it.input) })
    }
  }
  return rows
}

export function Transcript({ items, status }: Props): React.ReactElement {
  const listRef = useRef<FlatList<Row>>(null)
  const rows = toRows(items)
  const streaming = status === 'thinking'

  // Stick to the bottom while streaming, mirroring the PWA's sticky-scroll.
  useEffect(() => {
    if (rows.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))
    }
  }, [rows.length, streaming, items])

  return (
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={(r) => r.key}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={styles.gap} />}
      renderItem={({ item: r }) => {
        if (r.kind === 'user') {
          return (
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{r.text}</Text>
            </View>
          )
        }
        if (r.kind === 'assistant') {
          return <Text style={styles.assistantText}>{r.text}</Text>
        }
        if (r.kind === 'approval') {
          return (
            <View style={styles.toolRow}>
              <Text style={styles.toolDot}>▸</Text>
              <View style={styles.toolText}>
                <Text style={styles.toolName}>{r.text}</Text>
                {r.sub ? <Text style={styles.toolSub}>{r.sub}</Text> : null}
                <Text style={styles.approvalTag}>awaiting approval</Text>
              </View>
            </View>
          )
        }
        return (
          <View style={styles.toolRow}>
            <Text style={styles.toolDot}>·</Text>
            <View style={styles.toolText}>
              <Text style={styles.toolName}>{r.text}</Text>
              {r.sub ? <Text style={styles.toolSub}>{r.sub}</Text> : null}
            </View>
          </View>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 16, paddingVertical: 16, gap: 0 },
  gap: { height: 10 },
  userBubble: {
    backgroundColor: theme.userSurface,
    borderWidth: 1,
    borderColor: theme.userBorder,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignSelf: 'flex-end',
    maxWidth: '85%',
  },
  userText: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, lineHeight: 21 },
  assistantText: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, lineHeight: 21 },
  toolRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  toolDot: { color: theme.textFaint, fontSize: 14, fontFamily: theme.fontMono, lineHeight: 18 },
  toolText: { flex: 1, gap: 1 },
  toolName: { color: theme.accentBright, fontSize: 13, fontFamily: theme.fontMono },
  toolSub: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono },
  approvalTag: { color: theme.accent, fontSize: 11, fontFamily: theme.fontSans, marginTop: 2 },
})
