// Vendored from happy (slopus/happy, MIT), re-skinned for trux.
// Source: vendor/happy/packages/happy-app/sources/components/tools/views/WriteView.tsx
//
// Re-skin: stripped @/sync/storage (useSetting) → showLineNumbers defaults true.
// Import paths adjusted.

import React from 'react'
import { ToolSectionView } from '../ToolSectionView'
import { ToolDiffView } from '../ToolDiffView'
import { knownTools } from '../knownTools'
import type { ToolViewProps } from './_all'

export const WriteView = React.memo<ToolViewProps>(({ tool }) => {
  let contents = '<no contents>'
  const parsed = knownTools.Write.input.safeParse(tool.input)
  if (parsed.success) {
    const data = parsed.data as { content?: string }
    if (typeof data.content === 'string') contents = data.content
  }
  return (
    <ToolSectionView fullWidth>
      <ToolDiffView oldText={''} newText={contents} showLineNumbers showPlusMinusSymbols />
    </ToolSectionView>
  )
})
