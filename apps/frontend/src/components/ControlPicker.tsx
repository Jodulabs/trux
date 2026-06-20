import type { AgentCapabilities, TurnConfig } from '@trux/protocol'

interface Props {
  caps: AgentCapabilities
  value: TurnConfig
  onChange: (next: TurnConfig) => void
}

// One generic renderer for any backend's manifest — the unification point.
// Model is first-class; every control is drawn the same way from the manifest.
// A leading "— default —" option (value '') means "no override": trux does not pick.
export function ControlPicker({ caps, value, onChange }: Props): React.ReactElement {
  const setModel = (model: string): void => onChange({ ...value, model: model || null })
  const setOption = (key: string, v: string): void => {
    const options = { ...value.options }
    if (v) options[key] = v
    else delete options[key]
    onChange({ ...value, options })
  }

  return (
    <div className="control-picker">
      {caps.models.length > 0 && (
        <select
          data-testid="model-select"
          value={value.model ?? ''}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">— default —</option>
          {caps.models.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      )}
      {caps.controls.map((c) => (
        <select
          key={c.key}
          data-testid={`control-${c.key}`}
          value={value.options[c.key] ?? ''}
          onChange={(e) => setOption(c.key, e.target.value)}
        >
          <option value="">{c.label}: default</option>
          {c.options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ))}
    </div>
  )
}
