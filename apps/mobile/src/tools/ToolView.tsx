// Vendored from happy (slopus/happy, MIT), re-skinned and simplified for trux.
// Source: vendor/happy/packages/happy-app/sources/components/tools/ToolView.tsx
//
// Re-skin & simplification:
//   - stripped useUnistyles → direct trux theme import
//   - stripped expo-router (useRouter) — trux uses React Navigation, not file-based
//     routing for tool detail. onPress is optional from the parent.
//   - stripped useElapsedTime hook (trux doesn't carry wire timestamps; the
//     adapter sets createdAt to the fold time, so an elapsed timer would be
//     misleading). Will revisit in Phase B3 with proper timestamps.
//   - stripped @/utils/toolDisplay (getTerminalToolCommand, shouldRenderToolCardHeader)
//     — inlined the minimal logic needed for the 4 tools.
//   - stripped @/hooks/useElapsedTime
//   - stripped CodeView import from ../CodeView → local ./CodeView
//   - stripped MCP tool handling (not in the 4-tool scope)
//   - stripped Codex/Gemini flavor branches (not in scope yet)
//   - PermissionFooter wired to trux onRespond callback instead of happy's relay

import React from 'react'
import { Text, View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { ApprovalDecision } from '@trux/protocol'
import { getToolViewComponent } from './views/_all'
import type { ToolCall, Metadata, Message } from './types'
import { ToolSectionView } from './ToolSectionView'
import { ToolError } from './ToolError'
import { CodeView } from './CodeView'
import { knownTools } from './knownTools'
import { PermissionFooter } from './PermissionFooter'
import { parseToolUseError } from './utils'
import { t } from './i18n'
import { theme } from '../theme'

interface ToolViewProps {
  metadata: Metadata
  tool: ToolCall
  messages?: Message[]
  onPress?: () => void
  sessionId?: string
  approvalDecision?: ApprovalDecision
  onApprovalRespond?: (requestId: string, decision: ApprovalDecision) => void
}

export const ToolView = React.memo<ToolViewProps>((props) => {
  const { tool, onPress, sessionId, approvalDecision, onApprovalRespond } = props

  const knownTool = knownTools[tool.name]
  if (knownTool?.hidden) return null

  let description: string | null = null
  let status: string | null = null
  let minimal = false
  let icon: React.ReactElement = <Ionicons name="construct-outline" size={18} color={theme.textDim} />
  let noStatus = false
  let hideDefaultError = false

  if (knownTool && typeof knownTool.extractStatus === 'function') {
    const extracted = knownTool.extractStatus({ tool, metadata: props.metadata })
    if (typeof extracted === 'string' && extracted) status = extracted
  }

  let toolTitle = tool.name
  if (knownTool?.title) {
    toolTitle = typeof knownTool.title === 'function' ? knownTool.title({ tool, metadata: props.metadata }) : knownTool.title
  }

  if (knownTool && typeof knownTool.extractSubtitle === 'function') {
    const subtitle = knownTool.extractSubtitle({ tool, metadata: props.metadata })
    if (typeof subtitle === 'string' && subtitle) description = subtitle
  }

  if (knownTool && knownTool.minimal !== undefined) {
    minimal = typeof knownTool.minimal === 'function' ? knownTool.minimal({ tool, metadata: props.metadata, messages: props.messages }) : knownTool.minimal
  }

  if (knownTool && typeof knownTool.icon === 'function') {
    icon = knownTool.icon(18, theme.text)
  }

  if (knownTool && typeof knownTool.noStatus === 'boolean') noStatus = knownTool.noStatus
  if (knownTool && typeof knownTool.hideDefaultError === 'boolean') hideDefaultError = knownTool.hideDefaultError

  let isToolUseError = false
  if (tool.state === 'error' && tool.result && parseToolUseError(String(tool.result)).isToolUseError) {
    isToolUseError = true
  }

  let statusIcon: React.ReactElement | null = null
  if (tool.permission && (tool.permission.status === 'denied' || tool.permission.status === 'canceled')) {
    statusIcon = <Ionicons name="remove-circle-outline" size={20} color={theme.textDim} />
  } else if (isToolUseError) {
    statusIcon = <Ionicons name="remove-circle-outline" size={20} color={theme.textDim} />
    hideDefaultError = true
    minimal = true
  } else {
    switch (tool.state) {
      case 'running':
        if (!noStatus) statusIcon = <ActivityIndicator size="small" color={theme.text} style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }} />
        break
      case 'completed':
        break
      case 'error':
        statusIcon = <Ionicons name="alert-circle-outline" size={20} color={theme.warn} />
        break
    }
  }

  const renderPermissionFooter = () =>
    tool.permission && sessionId && onApprovalRespond ? (
      <PermissionFooter permission={tool.permission} toolName={tool.name} toolInput={tool.input} decision={approvalDecision} onRespond={onApprovalRespond} />
    ) : null

  const renderHeaderContent = () => (
    <View style={styles.headerLeft}>
      <View style={styles.iconContainer}>{icon}</View>
      <View style={styles.titleContainer}>
        <Text style={styles.toolName} numberOfLines={1}>
          {toolTitle}
          {status ? <Text style={styles.status}>{` ${status}`}</Text> : null}
        </Text>
        {description ? <Text style={styles.toolDescription} numberOfLines={1}>{description}</Text> : null}
      </View>
      {statusIcon}
    </View>
  )

  return (
    <View style={styles.container}>
      {onPress ? (
        <TouchableOpacity style={styles.header} onPress={onPress} activeOpacity={0.8}>
          {renderHeaderContent()}
        </TouchableOpacity>
      ) : (
        <View style={styles.header}>{renderHeaderContent()}</View>
      )}

      {(() => {
        if (minimal) return null
        const SpecificToolView = getToolViewComponent(tool.name)
        if (SpecificToolView) {
          return (
            <View style={styles.content}>
              <SpecificToolView tool={tool} metadata={props.metadata} messages={props.messages ?? []} sessionId={sessionId} />
              {tool.state === 'error' && tool.result &&
              !(tool.permission && (tool.permission.status === 'denied' || tool.permission.status === 'canceled')) &&
              !hideDefaultError ? (
                <ToolError message={String(tool.result)} />
              ) : null}
            </View>
          )
        }
        if (tool.state === 'error' && tool.result &&
        !(tool.permission && (tool.permission.status === 'denied' || tool.permission.status === 'canceled')) &&
        !isToolUseError) {
          return (
            <View style={styles.content}>
              <ToolError message={String(tool.result)} />
            </View>
          )
        }
        return (
          <View style={styles.content}>
            {tool.input ? (
              <ToolSectionView title={t('toolView.input')}>
                <CodeView code={JSON.stringify(tool.input, null, 2)} />
              </ToolSectionView>
            ) : null}
            {tool.state === 'completed' && tool.result ? (
              <ToolSectionView title={t('toolView.output')}>
                <CodeView code={typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)} />
              </ToolSectionView>
            ) : null}
          </View>
        )
      })()}

      {renderPermissionFooter()}
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.surface2,
    borderRadius: 8,
    marginVertical: 4,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: theme.surface3,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  iconContainer: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  titleContainer: { flex: 1 },
  toolName: { fontSize: 14, fontWeight: '500', color: theme.text },
  status: { fontWeight: '400', opacity: 0.3, fontSize: 15 },
  toolDescription: { fontSize: 13, color: theme.textDim, marginTop: 2 },
  content: { paddingHorizontal: 12, paddingTop: 8, overflow: 'visible' },
})
