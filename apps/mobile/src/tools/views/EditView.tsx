// Vendored from happy (slopus/happy, MIT), re-skinned for trux.
// Source: vendor/happy/packages/happy-app/sources/components/tools/views/EditView.tsx
//
// Re-skin: stripped @/sync/storage (useSetting) → showLineNumbers defaults true.
// Stripped @/utils/trimIdent → local ./utils. Import paths adjusted.

import React from 'react'
import { ToolSectionView } from '../ToolSectionView'
import { ToolDiffView } from '../ToolDiffView'
import { knownTools } from '../knownTools'
import { trimIdent } from '../utils'
import type { ToolViewProps } from './_all'

export const EditView = React.memo<ToolViewProps>(({ tool }) => {
  let oldString = ''
  let newString = ''
  const parsed = knownTools.Edit.input.safeParse(tool.input)
  if (parsed.success) {
    const data = parsed.data as { old_string?: string; new_string?: string }
    oldString = trimIdent(data.old_string || '')
    newString = trimIdent(data.new_string || '')
  }
  return (
    <ToolSectionView fullWidth>
      <ToolDiffView oldText={oldString} newText={newString} showLineNumbers showPlusMinusSymbols />
    </ToolSectionView>
  )
})
