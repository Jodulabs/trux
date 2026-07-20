import { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, Pressable, StyleSheet, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native'
import type { ApprovalDecision, ApprovalRequestEvent, ToolCallEvent, ToolResultEvent } from '@trux/protocol'
import type { TranscriptItem } from '@trux/client/store'
import { toolSummary } from '@trux/client/tools'
import { theme } from '../theme'
import { useReducedMotion } from '../motion'
import { pairTools, toToolCall } from '../toolView'
import { Markdown } from './Markdown'
import { ApprovalCard, type PendingApproval } from './ApprovalCard'
import { ToolActivityGroup } from './ToolActivityGroup'
import type { ToolCall, Metadata } from '../tools/types'

interface Props {
  items: TranscriptItem[]
  status: string
  approvalDecisions: Record<string, ApprovalDecision>
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  sessionId?: string
  /** When true, unresolved approvals are omitted (parent pins the latest). */
  hidePendingApprovals?: boolean
}

type Row =
  | { kind: 'user'; key: string; text: string; pending?: boolean; failed?: boolean }
  | { kind: 'assistant'; key: string; text: string; streaming?: boolean }
  | { kind: 'toolGroup'; key: string; tools: ToolCall[] }
  | { kind: 'approval'; key: string; approval: PendingApproval }

const NEAR_BOTTOM_PX = 80
const FAB_SHOW_PX = 300

export function findLatestPendingApproval(
  items: TranscriptItem[],
  approvalDecisions: Record<string, ApprovalDecision>,
): PendingApproval | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type !== 'approval_request') continue
    const ar = item as ApprovalRequestEvent
    if (approvalDecisions[ar.request_id]) continue
    return {
      requestId: ar.request_id,
      tool: ar.tool,
      input: ar.input,
      summary: toolSummary(ar.tool, ar.input),
      explanation: ar.explanation,
    }
  }
  return null
}

export function toRows(
  items: TranscriptItem[],
  approvalDecisions: Record<string, ApprovalDecision>,
  opts: { hidePendingApprovals?: boolean; streaming?: boolean } = {},
): Row[] {
  const rows: Row[] = []
  let toolRun: Array<ToolCallEvent | ToolResultEvent> = []
  let runStart = -1

  const flushTools = () => {
    if (toolRun.length > 0) {
      const paired = pairTools(toolRun, approvalDecisions)
      const tools = paired.map(toToolCall)
      rows.push({ kind: 'toolGroup', key: `tg${runStart}`, tools })
      toolRun = []
      runStart = -1
    }
  }

  items.forEach((item, index) => {
    if (item.type === 'tool_call' || item.type === 'tool_result') {
      if (runStart === -1) runStart = index
      toolRun.push(item)
    } else if (item.type === 'approval_request') {
      flushTools()
      const ar = item as ApprovalRequestEvent
      const decision = approvalDecisions[ar.request_id]
      if (opts.hidePendingApprovals && !decision) return
      rows.push({
        kind: 'approval',
        key: `a${index}`,
        approval: {
          requestId: ar.request_id,
          tool: ar.tool,
          input: ar.input,
          summary: toolSummary(ar.tool, ar.input),
          explanation: ar.explanation,
          decision,
        },
      })
    } else if (item.type === 'user_text') {
      flushTools()
      const o = item as TranscriptItem & { pending?: boolean; failed?: boolean }
      rows.push({ kind: 'user', key: `u${index}`, text: item.text, pending: o.pending, failed: o.failed })
    } else if (item.type === 'text') {
      flushTools()
      rows.push({ kind: 'assistant', key: `t${index}`, text: item.text })
    }
  })
  flushTools()

  // Mark the last assistant row as streaming when the agent is thinking.
  if (opts.streaming) {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].kind === 'assistant') {
        ;(rows[i] as Extract<Row, { kind: 'assistant' }>).streaming = true
        break
      }
    }
  }
  return rows
}

export function Transcript({
  items,
  status,
  approvalDecisions,
  onRespond,
  sessionId,
  hidePendingApprovals,
}: Props): React.ReactElement {
  const listRef = useRef<FlatList<Row>>(null)
  const nearBottom = useRef(true)
  const contentHeight = useRef(0)
  const layoutHeight = useRef(0)
  const reducedMotion = useReducedMotion()
  const streaming = status === 'thinking'
  const rows = toRows(items, approvalDecisions, { hidePendingApprovals, streaming })
  const [showFab, setShowFab] = useState(false)
  const [fabPulse, setFabPulse] = useState(false)
  const prevLen = useRef(rows.length)

  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated: animated && !reducedMotion })
      nearBottom.current = true
      setShowFab(false)
      setFabPulse(false)
    })
  }, [reducedMotion])

  useEffect(() => {
    const grew = rows.length > prevLen.current || streaming
    prevLen.current = rows.length
    if (!grew || rows.length === 0) return
    if (nearBottom.current) {
      scrollToLatest(true)
    } else {
      setFabPulse(true)
      setShowFab(true)
    }
  }, [rows.length, streaming, items, scrollToLatest])

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent
    contentHeight.current = contentSize.height
    layoutHeight.current = layoutMeasurement.height
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height)
    nearBottom.current = distance < NEAR_BOTTOM_PX
    const far = distance > FAB_SHOW_PX
    setShowFab(far)
    if (!far) setFabPulse(false)
  }

  const metadata: Metadata = null

  return (
    <View style={styles.shell}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.gap} />}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={() => {
          if (nearBottom.current) scrollToLatest(false)
        }}
        renderItem={({ item: r }) => {
          if (r.kind === 'user') {
            return (
              <View style={[styles.userBubble, r.failed && styles.userBubbleFailed]}>
                <Text style={styles.userText}>{r.text}</Text>
                {r.pending ? <Text style={styles.msgState}>sending…</Text> : null}
                {r.failed ? <Text style={styles.msgStateFailed}>failed — will retry</Text> : null}
              </View>
            )
          }
          if (r.kind === 'assistant') {
            return <Markdown text={r.text} streaming={r.streaming} reduceMotion={reducedMotion} />
          }
          if (r.kind === 'approval') {
            return <ApprovalCard approval={r.approval} onRespond={onRespond} />
          }
          return (
            <ToolActivityGroup
              groupKey={r.key}
              tools={r.tools}
              status={status}
              sessionId={sessionId}
              onRespond={onRespond}
              metadata={metadata}
            />
          )
        }}
      />
      {showFab ? (
        <Pressable
          style={[styles.fab, fabPulse && styles.fabPulse]}
          onPress={() => scrollToLatest(true)}
          accessibilityRole="button"
          accessibilityLabel="Scroll to latest"
        >
          <Text style={styles.fabText}>↓</Text>
          {fabPulse ? <View style={styles.fabDot} /> : null}
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  list: { paddingHorizontal: 16, paddingVertical: 16, flexGrow: 1 },
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
  userBubbleFailed: { borderColor: theme.error },
  userText: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, lineHeight: 21 },
  msgState: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontSans, marginTop: 4 },
  msgStateFailed: { color: theme.error, fontSize: 11, fontFamily: theme.fontSans, marginTop: 4 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.surface2,
    borderWidth: 1.5,
    borderColor: theme.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabPulse: { borderColor: theme.accentBright },
  fabText: { color: theme.accentBright, fontSize: 18, fontFamily: theme.fontSans },
  fabDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
})
