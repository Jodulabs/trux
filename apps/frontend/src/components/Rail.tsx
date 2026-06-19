interface Props {
  onNew: () => void
  onToggleList: () => void
}

export function Rail({ onNew, onToggleList }: Props): React.ReactElement {
  return (
    <nav className="rail" data-testid="rail" aria-label="Primary">
      <span className="rail-mark" aria-hidden>▰</span>
      <button className="rail-btn" data-testid="rail-new" aria-label="New conversation" onClick={onNew}>＋</button>
      <button className="rail-btn" data-testid="rail-list" aria-label="Conversations" onClick={onToggleList}>☰</button>
    </nav>
  )
}
