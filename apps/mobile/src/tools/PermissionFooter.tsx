// PermissionFooter — re-skinned and rewired from happy (slopus/happy, MIT).
// Source: vendor/happy/packages/happy-app/sources/components/tools/PermissionFooter.tsx
//
// Key difference from happy: trux has no relay server. Approvals are sent as
// `approval_response` messages over the direct WS via the connection manager.
// The PWA's ApprovalCard shows the same graduated trust buttons; this native
// version mirrors that, styled as a footer inside the tool card.
//
// Re-skin: stripped useUnistyles → trux theme. Stripped @/sync/ops (relay) →
// trux onRespond callback. Stripped @/sync/storage (settings) → props.

import React, { useState } from 'react'
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ApprovalDecision } from '@trux/protocol'
import type { ToolPermission } from './types'
import { theme } from '../theme'

interface PermissionFooterProps {
  permission: ToolPermission
  toolName: string
  toolInput?: any
  decision?: ApprovalDecision
  onRespond: (requestId: string, decision: ApprovalDecision) => void
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export const PermissionFooter: React.FC<PermissionFooterProps> = ({
  permission,
  toolName,
  decision,
  onRespond,
}) => {
  const [loadingButton, setLoadingButton] = useState<'allow' | 'deny' | 'edits' | 'command' | null>(null)
  const isEdit = EDIT_TOOLS.has(toolName)
  const isBash = toolName === 'Bash'
  const decided = decision !== undefined
  const pending = permission.status === 'pending' && !decided

  const handle = (reqId: string, d: ApprovalDecision, btn: 'allow' | 'deny' | 'edits' | 'command') => {
    if (!pending || loadingButton !== null) return
    setLoadingButton(btn)
    onRespond(reqId, d)
    // The parent re-renders with the decision; reset after a beat.
    setTimeout(() => setLoadingButton(null), 300)
  }

  const btn = (
    label: string,
    d: ApprovalDecision,
    btnKey: 'allow' | 'deny' | 'edits' | 'command',
    primary?: boolean,
  ) => {
    const isChosen = decision === d
    const loading = loadingButton === btnKey
    return (
      <TouchableOpacity
        style={[styles.btn, primary ? styles.btnPrimary : null, decided ? (isChosen ? styles.btnChosen : styles.btnDimmed) : null]}
        disabled={!pending || loading}
        onPress={() => handle(permission.id, d, btnKey)}
        activeOpacity={0.7}
      >
        {loading ? (
          <ActivityIndicator size="small" color={primary ? theme.ink : theme.text} />
        ) : (
          <Text style={[styles.btnText, primary ? styles.btnTextPrimary : null, decided && !isChosen && styles.btnTextDimmed]}>
            {label}
          </Text>
        )}
      </TouchableOpacity>
    )
  }

  if (decided) {
    return (
      <View style={styles.decidedFooter}>
        <Ionicons
          name={decision === 'deny' ? 'close-circle' : 'checkmark-circle'}
          size={16}
          color={decision === 'deny' ? theme.error : theme.ok}
        />
        <Text style={styles.decidedText}>{decision === 'deny' ? 'Denied' : `Approved (${decision})`}</Text>
      </View>
    )
  }

  if (!pending) return null

  return (
    <View style={styles.footer}>
      {btn('Allow once', 'allow', 'allow', true)}
      {isEdit ? btn('Allow all edits', 'allow_edits', 'edits') : null}
      {isBash ? btn('Allow this command', 'allow_command', 'command') : null}
      {!isEdit && !isBash ? btn('Always', 'allow_always', 'allow') : null}
      {btn('Deny', 'deny', 'deny')}
    </View>
  )
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.line,
    backgroundColor: theme.surface2,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  btnChosen: {
    backgroundColor: theme.accentSoft,
    borderColor: theme.accent,
  },
  btnDimmed: {
    opacity: 0.4,
  },
  btnText: {
    fontSize: 13,
    color: theme.text,
    fontFamily: theme.fontSans,
  },
  btnTextPrimary: {
    color: theme.ink,
    fontWeight: '600',
  },
  btnTextDimmed: {
    opacity: 0.5,
  },
  decidedFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  decidedText: {
    fontSize: 13,
    color: theme.textDim,
    fontFamily: theme.fontSans,
  },
})
