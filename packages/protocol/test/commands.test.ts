import { describe, expect, it } from 'vitest'
import { resolveCommand, type AgentCommand, type CommandsResponse } from '../src/index'

describe('resolveCommand', () => {
  it('substitutes $ARGUMENTS', () => {
    expect(resolveCommand('Review $ARGUMENTS now', { ARGUMENTS: 'the diff' })).toBe('Review the diff now')
  })
  it('substitutes positional $1..$9', () => {
    expect(resolveCommand('a $1 b $2', { '1': 'x', '2': 'y' })).toBe('a x b y')
  })
  it('resolves missing placeholders to empty string', () => {
    expect(resolveCommand('a $1 $ARGUMENTS', {})).toBe('a  ')
  })
  it('leaves $10 untouched (only $1..$9 are positional)', () => {
    expect(resolveCommand('$10', {})).toBe('$10')
  })
})

describe('command dtos', () => {
  it('builds an AgentCommand and CommandsResponse', () => {
    const cmd: AgentCommand = {
      name: 'review', description: 'Review code', body: 'Review $ARGUMENTS',
      args: [{ name: 'ARGUMENTS', label: 'What to review', required: true }], source: 'file',
    }
    const resp: CommandsResponse = { commands: [cmd] }
    expect(resp.commands[0]?.args[0]?.name).toBe('ARGUMENTS')
  })
})
