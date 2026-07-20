import { View, Text, StyleSheet } from 'react-native'
import type { ApprovalDecision } from '@trux/protocol'
import { theme } from '../theme'
import { PermissionFooter } from '../tools/PermissionFooter'

export interface PendingApproval {
  requestId: string
  tool: string
  input: unknown
  summary: string
  explanation?: string
  decision?: ApprovalDecision
}

interface Props {
  approval: PendingApproval
  onRespond: (requestId: string, decision: ApprovalDecision) => void
  pinned?: boolean
}

/** Single approval UI — uses PermissionFooter buttons everywhere (no Text-as-button). */
export function ApprovalCard({ approval, onRespond, pinned }: Props): React.ReactElement {
  return (
    <View
      style={[styles.card, pinned && styles.pinned]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.title}>
        Approve <Text style={styles.toolName}>{approval.tool}</Text>?
      </Text>
      {approval.explanation ? <Text style={styles.why}>{approval.explanation}</Text> : null}
      {approval.summary ? <Text style={styles.subject}>{approval.summary}</Text> : null}
      <PermissionFooter
        permission={{ id: approval.requestId, status: approval.decision ? 'approved' : 'pending' }}
        toolName={approval.tool}
        toolInput={approval.input}
        decision={approval.decision}
        onRespond={onRespond}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.surface2,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: theme.radius,
    overflow: 'hidden',
  },
  pinned: {
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
  },
  title: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: theme.fontSans,
    paddingHorizontal: 14,
    paddingTop: 14,
  },
  toolName: { color: theme.accentBright, fontFamily: theme.fontMono },
  why: {
    color: theme.textDim,
    fontSize: 13,
    fontFamily: theme.fontSans,
    marginTop: 6,
    paddingHorizontal: 14,
  },
  subject: {
    color: theme.accentBright,
    fontSize: 13,
    fontFamily: theme.fontMono,
    marginTop: 8,
    marginHorizontal: 14,
    padding: 8,
    backgroundColor: theme.ink,
    borderRadius: 6,
  },
})
