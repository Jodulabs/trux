import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import type { AgentCapabilities } from '@trux/protocol'
import { ControlPicker } from '../src/components/ControlPicker'

afterEach(cleanup)

const claude: AgentCapabilities = {
  agent: 'claude',
  models: [
    { value: 'claude-opus-4-8', label: 'Opus 4.8' },
    { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  ],
  defaultModel: null,
  controls: [
    { key: 'effort', label: 'Effort', options: [{ value: 'high', label: 'High' }], default: '' },
  ],
}

const empty: AgentCapabilities = { agent: 'codex', models: [], defaultModel: null, controls: [] }

describe('ControlPicker', () => {
  it('renders a model dropdown + one dropdown per control', () => {
    render(<ControlPicker caps={claude} value={{ model: null, options: {} }} onChange={() => {}} />)
    expect(screen.getByTestId('model-select')).toBeTruthy()
    expect(screen.getByTestId('control-effort')).toBeTruthy()
  })

  it('omits the model dropdown for an empty manifest', () => {
    render(<ControlPicker caps={empty} value={{ model: null, options: {} }} onChange={() => {}} />)
    expect(screen.queryByTestId('model-select')).toBeNull()
  })

  it('emits the model selection on change', () => {
    const onChange = vi.fn()
    render(<ControlPicker caps={claude} value={{ model: null, options: {} }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('model-select'), { target: { value: 'claude-sonnet-4-6' } })
    expect(onChange).toHaveBeenCalledWith({ model: 'claude-sonnet-4-6', options: {} })
  })

  it('emits a control selection keyed by control key, and clears on default', () => {
    const onChange = vi.fn()
    render(<ControlPicker caps={claude} value={{ model: null, options: {} }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('control-effort'), { target: { value: 'high' } })
    expect(onChange).toHaveBeenLastCalledWith({ model: null, options: { effort: 'high' } })
    // Switching back to default removes the key (no override).
    fireEvent.change(screen.getByTestId('control-effort'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ model: null, options: {} })
  })
})
