import { useEffect, useState } from 'react'
import type { GitFileStatus, GitStatusResult } from '@trux/protocol'
import { api } from '../api'
import { DiffView } from './DiffView'

interface Props {
  conversationId: string
  onClose: () => void
}

export function GitPanel({ conversationId, onClose }: Props): React.ReactElement {
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [commitMsg, setCommitMsg] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<string | null>(null)
  const [diffFor, setDiffFor] = useState<{ path: string; staged: boolean } | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')

  const reload = async (): Promise<void> => {
    setLoading(true)
    try {
      setStatus(await api.gitStatus(conversationId))
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [conversationId])

  const toggle = async (f: GitFileStatus): Promise<void> => {
    try {
      if (f.staged) await api.gitUnstage(conversationId, f.path)
      else await api.gitStage(conversationId, f.path)
      await reload()
    } catch {}
  }

  const openDiff = async (path: string, staged: boolean): Promise<void> => {
    setDiffFor({ path, staged })
    try {
      const { diff } = await api.gitDiff(conversationId, { path, staged })
      setDiffContent(diff)
    } catch {
      setDiffContent('')
    }
  }

  const commit = async (): Promise<void> => {
    if (!commitMsg.trim() || committing) return
    setCommitting(true)
    setCommitResult(null)
    try {
      const r = await api.gitCommit(conversationId, commitMsg)
      if (r.ok) {
        setCommitMsg('')
        setCommitResult(`Committed ${r.hash}`)
        await reload()
      } else {
        setCommitResult(r.error ?? 'Commit failed')
      }
    } finally {
      setCommitting(false)
    }
  }

  const files = status?.repo ? status.files : []
  const staged = files.filter((f) => f.staged)
  const unstaged = files.filter((f) => !f.staged)

  return (
    <>
      {diffFor ? (
        <DiffView
          title={diffFor.path}
          diff={diffContent}
          onClose={() => setDiffFor(null)}
        />
      ) : null}
      <div className="diff-overlay" data-testid="git-panel-overlay" onClick={onClose}>
        <div className="git-panel" onClick={(e) => e.stopPropagation()}>
          <div className="diff-header">
            <span className="diff-title">Git</span>
            {status?.repo && status.branch ? (
              <span className="git-branch">{status.branch}</span>
            ) : null}
            {status?.repo && (status.ahead > 0 || status.behind > 0) ? (
              <span className="git-tracking">
                {status.ahead > 0 ? `↑${status.ahead}` : ''}
                {status.behind > 0 ? `↓${status.behind}` : ''}
              </span>
            ) : null}
            <button className="diff-close" onClick={onClose} aria-label="Close git panel">✕</button>
          </div>

          {loading ? (
            <div className="git-loading">Loading…</div>
          ) : !status?.repo ? (
            <div className="git-empty">Not a git repository.</div>
          ) : (
            <div className="git-scroll">
              {staged.length > 0 && (
                <section className="git-section">
                  <div className="git-section-label">Staged</div>
                  {staged.map((f) => (
                    <div key={f.path} className="git-file-row" data-testid="git-file-row">
                      <button
                        className="git-stage-btn staged"
                        onClick={() => void toggle(f)}
                        aria-label={`Unstage ${f.path}`}
                        data-testid="git-unstage"
                      >−</button>
                      <button
                        className="git-file-path"
                        onClick={() => void openDiff(f.path, true)}
                        data-testid="git-file-path"
                      >{f.path}</button>
                      <span className="git-file-status">{f.index}</span>
                    </div>
                  ))}
                </section>
              )}

              {unstaged.length > 0 && (
                <section className="git-section">
                  <div className="git-section-label">Changes</div>
                  {unstaged.map((f) => (
                    <div key={f.path} className="git-file-row" data-testid="git-file-row">
                      <button
                        className="git-stage-btn"
                        onClick={() => void toggle(f)}
                        aria-label={`Stage ${f.path}`}
                        data-testid="git-stage"
                      >+</button>
                      <button
                        className="git-file-path"
                        onClick={() => void openDiff(f.path, false)}
                        data-testid="git-file-path"
                      >{f.path}</button>
                      <span className="git-file-status">{f.work}</span>
                    </div>
                  ))}
                </section>
              )}

              {files.length === 0 && (
                <div className="git-empty-inner">Clean — nothing to commit.</div>
              )}

              <div className="git-commit-area">
                <textarea
                  className="git-commit-msg"
                  placeholder="Commit message…"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  rows={3}
                  data-testid="git-commit-msg"
                />
                <button
                  className="git-commit-btn"
                  onClick={() => void commit()}
                  disabled={committing || staged.length === 0 || !commitMsg.trim()}
                  data-testid="git-commit-btn"
                >
                  {committing ? 'Committing…' : 'Commit staged'}
                </button>
                {commitResult ? (
                  <div className="git-commit-result" data-testid="git-commit-result">{commitResult}</div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
