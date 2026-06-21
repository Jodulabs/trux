import { useMemo } from 'react'
import { parseDiff } from '@trux/client/diff'

interface Props {
  title?: string
  diff: string
  onClose: () => void
}

export function DiffView({ title, diff, onClose }: Props): React.ReactElement {
  const parsed = useMemo(() => parseDiff(diff), [diff])

  return (
    <div className="diff-overlay" data-testid="diff-overlay" onClick={onClose}>
      <div className="diff-panel" onClick={(e) => e.stopPropagation()}>
        <div className="diff-header">
          <span className="diff-title">{title ?? 'Diff'}</span>
          {(parsed.added > 0 || parsed.deleted > 0) && (
            <span className="diff-counts">
              {parsed.added > 0 && <span className="diff-add">+{parsed.added}</span>}
              {parsed.deleted > 0 && <span className="diff-del">−{parsed.deleted}</span>}
            </span>
          )}
          <button className="diff-close" onClick={onClose} aria-label="Close diff">✕</button>
        </div>
        {parsed.hunks.length === 0 ? (
          <div className="diff-empty">No changes.</div>
        ) : (
          <div className="diff-scroll">
            {parsed.hunks.map((hunk, hi) => (
              <div key={hi} className="diff-hunk">
                <div className="diff-hunk-header">{hunk.header}</div>
                {hunk.lines.map((line, li) => (
                  <div key={li} className={`diff-line ${line.kind}`}>
                    <span className="diff-gutter">{line.oldLine ?? ''}</span>
                    <span className="diff-gutter">{line.newLine ?? ''}</span>
                    <span className="diff-sign">
                      {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
                    </span>
                    <span className="diff-text">{line.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
