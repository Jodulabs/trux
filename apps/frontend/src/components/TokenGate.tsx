import React from 'react'
import { getStorage } from '@trux/client/ports'

interface Props {
  onSaved: () => void
}

export function TokenGate({ onSaved }: Props): React.ReactElement {
  const [value, setValue] = React.useState('')

  const save = (): void => {
    const trimmed = value.trim()
    if (!trimmed) return
    getStorage().set('trux_token', trimmed)
    onSaved()
  }

  return (
    <div className="token-gate" data-testid="token-gate">
      <p>A bearer token is required to access this instance.</p>
      <input
        data-testid="token-input"
        type="password"
        placeholder="Paste your token"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save() }}
      />
      <button data-testid="token-save" onClick={save}>Save token</button>
      <p className="token-hint">
        On this box, run <code>trux open</code> to launch already signed in.
        Otherwise your token is <code>TRUX_SECRET</code> in <code>~/.trux/.env</code>.
        On your phone, scan the QR from <code>trux pair</code> instead of typing it.
      </p>
    </div>
  )
}
