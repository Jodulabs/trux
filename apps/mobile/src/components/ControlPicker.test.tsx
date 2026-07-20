import { render, screen, fireEvent } from '@testing-library/react-native'
import { ControlPicker } from './ControlPicker'
import type { AgentCapabilities, TurnConfig } from '@trux/protocol'

const caps: AgentCapabilities = {
  agent: 'claude',
  models: [
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'opus', label: 'Opus' },
  ],
  defaultModel: null,
  controls: [
    {
      key: 'effort',
      label: 'Effort',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ],
      default: '',
    },
  ],
}

const initialConfig: TurnConfig = { model: null, options: {} }

describe('ControlPicker', () => {
  it('renders a collapsed summary showing defaults', async () => {
    await render(<ControlPicker caps={caps} value={initialConfig} onChange={() => {}} />)
    expect(screen.getByText(/default/)).toBeTruthy()
  })

  it('expands to show model and control chips', async () => {
    await render(<ControlPicker caps={caps} value={initialConfig} onChange={() => {}} />)
    await fireEvent.press(screen.getByText(/default/))
    expect(screen.getByText('Model')).toBeTruthy()
    expect(screen.getByText('Effort')).toBeTruthy()
    expect(screen.getByText('Sonnet')).toBeTruthy()
    expect(screen.getByText('Opus')).toBeTruthy()
    expect(screen.getByText('Low')).toBeTruthy()
    expect(screen.getByText('High')).toBeTruthy()
  })

  it('emits model change when a model chip is pressed', async () => {
    const onChange = jest.fn()
    await render(<ControlPicker caps={caps} value={initialConfig} onChange={onChange} />)
    await fireEvent.press(screen.getByText(/default/))
    await fireEvent.press(screen.getByText('Sonnet'))
    expect(onChange).toHaveBeenCalledWith({ model: 'sonnet', options: {} })
  })

  it('emits option change when a control chip is pressed', async () => {
    const onChange = jest.fn()
    await render(<ControlPicker caps={caps} value={initialConfig} onChange={onChange} />)
    await fireEvent.press(screen.getByText(/default/))
    await fireEvent.press(screen.getByText('High'))
    expect(onChange).toHaveBeenCalledWith({ model: null, options: { effort: 'high' } })
  })

  it('clears model back to default when default chip is pressed', async () => {
    const onChange = jest.fn()
    const withModel: TurnConfig = { model: 'opus', options: {} }
    await render(<ControlPicker caps={caps} value={withModel} onChange={onChange} />)
    await fireEvent.press(screen.getByText(/Opus/))
    // Find the "default" chip in the Model section (there are multiple "default" chips)
    const defaults = screen.getAllByText('default')
    await fireEvent.press(defaults[0])
    expect(onChange).toHaveBeenCalledWith({ model: null, options: {} })
  })

  it('renders with free-text model input for agents with no models (codex)', async () => {
    const empty: AgentCapabilities = { agent: 'codex', models: [], defaultModel: null, controls: [] }
    await render(<ControlPicker caps={empty} value={initialConfig} onChange={() => {}} />)
    // The picker renders (not null) — the summary is visible.
    expect(screen.toJSON()).not.toBeNull()
    expect(screen.getByText(/default/)).toBeTruthy()
  })

  it('shows a free-text model input when expanded and no model chips', async () => {
    const empty: AgentCapabilities = { agent: 'codex', models: [], defaultModel: null, controls: [] }
    await render(<ControlPicker caps={empty} value={initialConfig} onChange={() => {}} />)
    await fireEvent.press(screen.getByText(/default/))
    expect(screen.getByPlaceholderText('model id…')).toBeTruthy()
    expect(screen.getByText('Model')).toBeTruthy()
    expect(screen.getByText('Permissions')).toBeTruthy()
  })

  it('emits model change when free-text model is typed', async () => {
    const empty: AgentCapabilities = { agent: 'codex', models: [], defaultModel: null, controls: [] }
    const onChange = jest.fn()
    await render(<ControlPicker caps={empty} value={initialConfig} onChange={onChange} />)
    await fireEvent.press(screen.getByText(/default/))
    await fireEvent.changeText(screen.getByPlaceholderText('model id…'), 'o4-mini')
    expect(onChange).toHaveBeenCalledWith({ model: 'o4-mini', options: {} })
  })

  it('emits trust change when the Allow all chip is pressed', async () => {
    const onChange = jest.fn()
    await render(<ControlPicker caps={caps} value={initialConfig} onChange={onChange} />)
    await fireEvent.press(screen.getByText(/default/))
    await fireEvent.press(screen.getByText('Allow all'))
    expect(onChange).toHaveBeenCalledWith({ model: null, options: {}, trust: 'allow_all' })
  })

  it('reflects trust=allow_all in the summary label', async () => {
    const withTrust: TurnConfig = { model: null, options: {}, trust: 'allow_all' }
    await render(<ControlPicker caps={caps} value={withTrust} onChange={() => {}} />)
    expect(screen.getByText(/allow all/)).toBeTruthy()
  })
})
