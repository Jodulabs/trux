import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// Capture the openTerminal handle so the test can drive it.
const handle = {
  outputCb: null as null | ((d: string) => void),
  inputs: [] as string[],
  resizes: [] as [number, number][],
  closed: false,
  onOutput(cb: (d: string) => void) { this.outputCb = cb },
  onExit() {},
  onError() {},
  sendInput(d: string) { this.inputs.push(d) },
  sendResize(c: number, r: number) { this.resizes.push([c, r]) },
  close() { this.closed = true },
}
vi.mock('@trux/client/terminalClient', () => ({ openTerminal: vi.fn(() => handle) }))

// Minimal xterm + fit-addon stubs.
let termInstance: { written: string[]; dataCb: ((d: string) => void) | null; cols: number; rows: number }
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function (this: unknown) {
    termInstance = { written: [], dataCb: null, cols: 80, rows: 24 }
    return {
      loadAddon: () => {},
      open: () => {},
      write: (d: string) => termInstance.written.push(d),
      onData: (cb: (d: string) => void) => { termInstance.dataCb = cb; return { dispose: () => {} } },
      dispose: () => {},
      get cols() { return termInstance.cols },
      get rows() { return termInstance.rows },
    }
  }),
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: vi.fn(function (this: unknown) { return { fit: () => {} } }) }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

import { openTerminal } from '@trux/client/terminalClient'
import { TerminalPane } from '../src/components/TerminalPane'

beforeEach(() => { handle.inputs = []; handle.resizes = []; handle.outputCb = null })

describe('TerminalPane', () => {
  it('opens the terminal for the conversation and wires output→write and input→sendInput', () => {
    render(<TerminalPane conversationId="c1" />)
    expect(openTerminal).toHaveBeenCalledWith('c1')

    handle.outputCb?.('boot\n')
    expect(termInstance.written).toContain('boot\n')

    termInstance.dataCb?.('echo hi\n')
    expect(handle.inputs).toEqual(['echo hi\n'])
  })
})
