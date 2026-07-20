import { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import type { ApprovalDecision } from '@trux/protocol'
import { theme } from '../theme'
import { ToolView } from '../tools/ToolView'
import type { ToolCall, Metadata } from '../tools/types'

interface Props {
  groupKey: string
  tools: ToolCall[]
  status: string
  sessionId?: string
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  metadata: Metadata
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const rem = s % 60
  return m > 0 ? `${m}:${String(rem).padStart(2, '0')}` : `${rem}s`
}

function needsApproval(tools: ToolCall[]): boolean {
  return tools.some((t) => t.permission?.status === 'pending')
}

function isRunning(tools: ToolCall[], status: string): boolean {
  if (needsApproval(tools)) return true
  if (status === 'thinking' || status === 'awaiting_approval') {
    return tools.some((t) => t.state === 'running')
  }
  return false
}

export function ToolActivityGroup({
  groupKey,
  tools,
  status,
  sessionId,
  onRespond,
  metadata,
}: Props): React.ReactElement {
  const running = isRunning(tools, status)
  const mustExpand = needsApproval(tools)
  const [manual, setManual] = useState<'open' | 'closed' | null>(null)
  const [tick, setTick] = useState(0)

  // Auto: expanded while running / needs approval; collapsed when idle — unless user overrode.
  const expanded = manual === 'open' ? true : manual === 'closed' ? !mustExpand : running || mustExpand

  useEffect(() => {
    if (mustExpand && manual === 'closed') setManual(null)
  }, [mustExpand, manual])

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  const started = Math.min(...tools.map((t) => t.startedAt ?? t.createdAt))
  const ended = running
    ? Date.now()
    : Math.max(...tools.map((t) => t.completedAt ?? t.startedAt ?? t.createdAt))
  void tick
  const elapsed = formatElapsed(ended - started)
  const names = Array.from(new Set(tools.map((t) => t.name)))
  const summary = names.length <= 2
    ? names.join(' · ')
    : `${names[0]} +${names.length - 1}`

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.header}
        onPress={() => setManual(expanded ? 'closed' : 'open')}
        accessibilityRole="button"
        accessibilityLabel={expanded ? 'Collapse tool activity' : 'Expand tool activity'}
        accessibilityState={{ expanded }}
      >
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
        <Text style={styles.summary} numberOfLines={1}>
          {summary} · {tools.length} step{tools.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.timer}>{running ? `Working ${elapsed}` : `Worked ${elapsed}`}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          {tools.map((tool, i) => (
            <ToolView
              key={`${groupKey}-${i}`}
              metadata={metadata}
              tool={tool}
              sessionId={sessionId}
              onApprovalRespond={onRespond}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.lineSoft,
    borderRadius: theme.radius,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.lineSoft,
  },
  chevron: { color: theme.textFaint, fontSize: 12, fontFamily: theme.fontMono, width: 12 },
  summary: { color: theme.textDim, fontSize: 12, fontFamily: theme.fontMono, flex: 1, minWidth: 0 },
  timer: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, fontVariant: ['tabular-nums'] },
  body: { gap: 2 },
})
