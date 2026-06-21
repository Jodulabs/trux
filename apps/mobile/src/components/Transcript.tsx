import { useEffect, useRef } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
import type { ApprovalDecision, ApprovalRequestEvent, ToolCallEvent, ToolResultEvent } from '@trux/protocol'
import type { TranscriptItem } from '@trux/client/store'
import { toolSummary } from '@trux/client/tools'
import { theme } from '../theme'
import { ToolView } from '../tools/ToolView'
import { pairTools, toToolCall } from '../toolView'
import { Markdown } from './Markdown'
import type { ToolCall, Metadata } from '../tools/types'

interface Props {
  items: TranscriptItem[]
  status: string
  approvalDecisions: Record<string, ApprovalDecision>
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  sessionId?: string
}

// A render-time row for the FlatList. Tool activity is folded into groups
// (like the PWA's ActivityGroup) but each tool in the group is rendered via
// the happy ToolView card. Approval requests render as standalone cards with
// a PermissionFooter.
type Row =
  | { kind: 'user'; key: string; text: string; pending?: boolean; failed?: boolean }
  | { kind: 'assistant'; key: string; text: string }
  | { kind: 'toolGroup'; key: string; tools: ToolCall[] }
  | { kind: 'approval'; key: string; tool: string; input: unknown; summary: string; requestId: string; explanation?: string; decision?: ApprovalDecision }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function toRows(items: TranscriptItem[], approvalDecisions: Record<string, ApprovalDecision>): Row[] {
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
      rows.push({
        kind: 'approval',
        key: `a${index}`,
        tool: ar.tool,
        input: ar.input,
        summary: toolSummary(ar.tool, ar.input),
        requestId: ar.request_id,
        explanation: ar.explanation,
        decision: approvalDecisions[ar.request_id],
      })
    } else if (item.type === 'user_text') {
      flushTools()
      const o = item as any
      rows.push({ kind: 'user', key: `u${index}`, text: item.text, pending: o.pending, failed: o.failed })
    } else if (item.type === 'text') {
      flushTools()
      rows.push({ kind: 'assistant', key: `t${index}`, text: item.text })
    }
  })
  flushTools()
  return rows
}

export function Transcript({ items, status, approvalDecisions, onRespond, sessionId }: Props): React.ReactElement {
  const listRef = useRef<FlatList<Row>>(null)
  const rows = toRows(items, approvalDecisions)
  const streaming = status === 'thinking'

  useEffect(() => {
    if (rows.length > 0) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }))
    }
  }, [rows.length, streaming, items])

  const metadata: Metadata = null

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
            <View style={[styles.userBubble, r.failed && styles.userBubbleFailed]}>
              <Text style={styles.userText}>{r.text}</Text>
              {r.pending ? <Text style={styles.msgState}>sending…</Text> : null}
              {r.failed ? <Text style={styles.msgStateFailed}>failed — will retry</Text> : null}
            </View>
          )
        }
        if (r.kind === 'assistant') {
          return <Markdown text={r.text} />
        }
        if (r.kind === 'approval') {
          const isEdit = EDIT_TOOLS.has(r.tool)
          const isBash = r.tool === 'Bash'
          return (
            <View style={styles.approvalCard}>
              <Text style={styles.approvalTitle}>Approve <Text style={styles.toolName}>{r.tool}</Text>?</Text>
              {r.explanation ? <Text style={styles.approvalWhy}>{r.explanation}</Text> : null}
              {r.summary ? <Text style={styles.approvalSubject}>{r.summary}</Text> : null}
              {r.decision ? (
                <Text style={styles.approvalDecided}>You chose: {r.decision}</Text>
              ) : (
                <View style={styles.approvalActions}>
                  <Text style={styles.approvalBtnPrimary} onPress={() => onRespond(r.requestId, 'allow')}>Allow once</Text>
                  {isEdit ? <Text style={styles.approvalBtn} onPress={() => onRespond(r.requestId, 'allow_edits')}>Allow all edits</Text> : null}
                  {isBash ? <Text style={styles.approvalBtn} onPress={() => onRespond(r.requestId, 'allow_command')}>Allow this command</Text> : null}
                  {!isEdit && !isBash ? <Text style={styles.approvalBtn} onPress={() => onRespond(r.requestId, 'allow_always')}>Always</Text> : null}
                  <Text style={styles.approvalBtnDeny} onPress={() => onRespond(r.requestId, 'deny')}>Deny</Text>
                </View>
              )}
            </View>
          )
        }
        // toolGroup: render each tool via the happy ToolView card
        return (
          <View style={styles.toolGroup}>
            {r.tools.map((tool, i) => (
              <ToolView
                key={i}
                metadata={metadata}
                tool={tool}
                sessionId={sessionId}
                onApprovalRespond={onRespond}
              />
            ))}
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
  userBubbleFailed: { borderColor: theme.error },
  userText: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, lineHeight: 21 },
  msgState: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontSans, marginTop: 4 },
  msgStateFailed: { color: theme.error, fontSize: 11, fontFamily: theme.fontSans, marginTop: 4 },
  assistantText: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, lineHeight: 21 },
  toolGroup: { gap: 2 },
  approvalCard: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    padding: 14,
  },
  approvalTitle: { color: theme.text, fontSize: 15, fontWeight: '600', fontFamily: theme.fontSans },
  toolName: { color: theme.accentBright, fontFamily: theme.fontMono },
  approvalWhy: { color: theme.textDim, fontSize: 13, fontFamily: theme.fontSans, marginTop: 6 },
  approvalSubject: {
    color: theme.accentBright,
    fontSize: 13,
    fontFamily: theme.fontMono,
    marginTop: 8,
    padding: 8,
    backgroundColor: theme.ink,
    borderRadius: 6,
  },
  approvalDecided: { color: theme.ok, fontSize: 13, fontFamily: theme.fontSans, marginTop: 8 },
  approvalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  approvalBtnPrimary: {
    color: theme.ink,
    backgroundColor: theme.accent,
    fontSize: 13,
    fontFamily: theme.fontSans,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    overflow: 'hidden',
  },
  approvalBtn: {
    color: theme.text,
    backgroundColor: theme.surface3,
    fontSize: 13,
    fontFamily: theme.fontSans,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    overflow: 'hidden',
  },
  approvalBtnDeny: {
    color: theme.error,
    backgroundColor: theme.surface3,
    fontSize: 13,
    fontFamily: theme.fontSans,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    overflow: 'hidden',
  },
})
