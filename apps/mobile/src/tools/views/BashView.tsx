// Vendored from happy (slopus/happy, MIT), re-skinned for trux.
// Source: vendor/happy/packages/happy-app/sources/components/tools/views/BashView.tsx
//
// Re-skin: stripped @/sync/typesMessage → local types. Stripped @/components/CommandView
// → local ./CommandView. Import paths adjusted.

import React from 'react'
import type { ToolCall, Metadata } from '../types'
import { ToolSectionView } from '../ToolSectionView'
import { CommandView } from '../CommandView'
import { knownTools } from '../knownTools'

export const BashView = React.memo((props: { tool: ToolCall; metadata: Metadata; messages: any[]; sessionId?: string }) => {
  const { input, result, state } = props.tool

  let parsedResult: { stdout?: string; stderr?: string } | null = null
  let unparsedOutput: string | null = null
  let error: string | null = null

  if (state === 'completed' && result) {
    if (typeof result === 'string') {
      unparsedOutput = result
    } else {
      const parsed = knownTools.Bash.result?.safeParse(result)
      if (parsed?.success) {
        parsedResult = parsed.data as { stdout?: string; stderr?: string }
      } else {
        unparsedOutput = JSON.stringify(result)
      }
    }
  } else if (state === 'error' && typeof result === 'string') {
    error = result
  }

  return (
    <ToolSectionView>
      <CommandView
        command={input.command}
        stdout={parsedResult?.stdout ?? unparsedOutput ?? null}
        stderr={parsedResult?.stderr ?? null}
        error={error}
        hideEmptyOutput
      />
    </ToolSectionView>
  )
})
