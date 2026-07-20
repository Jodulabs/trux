import { describe, expect, it, beforeEach } from 'vitest'
import {
  PiDiscoverer,
  OpencodeDiscoverer,
  CodexDiscoverer,
  parsePiModelsTable,
  parseOpencodeModelsLines,
  clearDiscoveryCache,
  type RunFn,
} from '../src/discover'

beforeEach(() => clearDiscoveryCache())

// Real `pi --list-models` output (subset from the spike).
const PI_SAMPLE = `provider        model                                             context  max-out  thinking  images
amazon-bedrock  amazon.nova-2-lite-v1:0                           128K     4.1K     yes       yes
amazon-bedrock  anthropic.claude-fable-5                          1M       128K     yes       yes
amazon-bedrock  anthropic.claude-opus-4-8                         1M       128K     yes       yes
openai          gpt-4o                                            128K     16.4K    no        yes
openai          o3                                                200K     100K     yes       yes
anthropic       claude-sonnet-5                                   1M       128K     yes       yes
`

// Real `opencode models` output (subset from the spike).
const OPENCODE_SAMPLE = `opencode/big-pickle
opencode-go/glm-5.2
opencode-go/grok-4.5
amazon-bedrock/anthropic.claude-fable-5
amazon-bedrock/anthropic.claude-opus-4-8
openai/gpt-4o
`

describe('parsePiModelsTable', () => {
  it('parses provider/model rows into ControlOptions with provider/model values', () => {
    const models = parsePiModelsTable(PI_SAMPLE)
    expect(models).toContainEqual({ value: 'amazon-bedrock/anthropic.claude-opus-4-8', label: 'anthropic.claude-opus-4-8' })
    expect(models).toContainEqual({ value: 'openai/gpt-4o', label: 'gpt-4o' })
    expect(models).toContainEqual({ value: 'anthropic/claude-sonnet-5', label: 'claude-sonnet-5' })
  })

  it('skips the header line', () => {
    const models = parsePiModelsTable(PI_SAMPLE)
    expect(models.find((m) => m.value === 'provider/model')).toBeUndefined()
  })

  it('deduplicates by value (a model may appear under multiple regional providers)', () => {
    const dup = `provider        model                                             context  max-out  thinking  images
amazon-bedrock  claude-opus-4-8                                   1M       128K     yes       yes
au.anthropic    claude-opus-4-8                                   1M       128K     yes       yes
`
    const models = parsePiModelsTable(dup)
    // Two different provider prefixes → two different values, no dedup.
    expect(models).toHaveLength(2)
    expect(models.map((m) => m.value)).toEqual([
      'amazon-bedrock/claude-opus-4-8',
      'au.anthropic/claude-opus-4-8',
    ])
  })

  it('returns empty on empty/malformed input', () => {
    expect(parsePiModelsTable('')).toEqual([])
    expect(parsePiModelsTable('no header here\njust text\n')).toEqual([])
  })

  it('handles a model id containing a colon (version suffix)', () => {
    const table = `provider        model                                             context  max-out  thinking  images
amazon-bedrock  amazon.nova-2-lite-v1:0                           128K     4.1K     yes       yes
`
    const models = parsePiModelsTable(table)
    expect(models[0]).toEqual({ value: 'amazon-bedrock/amazon.nova-2-lite-v1:0', label: 'amazon.nova-2-lite-v1:0' })
  })
})

describe('parseOpencodeModelsLines', () => {
  it('parses provider/model lines into ControlOptions', () => {
    const models = parseOpencodeModelsLines(OPENCODE_SAMPLE)
    expect(models).toContainEqual({ value: 'opencode-go/glm-5.2', label: 'glm-5.2' })
    expect(models).toContainEqual({ value: 'amazon-bedrock/anthropic.claude-opus-4-8', label: 'anthropic.claude-opus-4-8' })
    expect(models).toContainEqual({ value: 'openai/gpt-4o', label: 'gpt-4o' })
  })

  it('skips lines without a slash', () => {
    const out = 'opencode/big-pickle\nnot-a-model\nopencode-go/glm-5.2\n'
    const models = parseOpencodeModelsLines(out)
    expect(models).toHaveLength(2)
  })

  it('handles model ids containing slashes after the provider prefix', () => {
    // Some opencode models have additional slashes in the id portion.
    const out = 'amazon-bedrock/anthropic/claude-fable-5\n'
    const models = parseOpencodeModelsLines(out)
    expect(models[0]).toEqual({ value: 'amazon-bedrock/anthropic/claude-fable-5', label: 'anthropic/claude-fable-5' })
  })

  it('deduplicates by value', () => {
    const out = 'opencode/big-pickle\nopencode/big-pickle\n'
    expect(parseOpencodeModelsLines(out)).toHaveLength(1)
  })

  it('returns empty on empty input', () => {
    expect(parseOpencodeModelsLines('')).toEqual([])
  })
})

describe('PiDiscoverer', () => {
  it('discovers models + the thinking control from a successful pi --list-models', () => {
    const run: RunFn = () => PI_SAMPLE
    const d = new PiDiscoverer(run)
    const caps = d.discover()
    expect(caps.agent).toBe('pi')
    expect(caps.models.length).toBeGreaterThan(0)
    expect(caps.models).toContainEqual({ value: 'openai/gpt-4o', label: 'gpt-4o' })
    expect(caps.defaultModel).toBeNull()
    const thinking = caps.controls.find((c) => c.key === 'thinking')
    expect(thinking).toBeDefined()
    expect(thinking?.options.map((o) => o.value)).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('falls back to empty models but keeps the thinking control on a failed spawn', () => {
    const run: RunFn = () => null
    const d = new PiDiscoverer(run)
    const caps = d.discover()
    expect(caps.models).toEqual([])
    expect(caps.controls.find((c) => c.key === 'thinking')).toBeDefined()
  })
})

describe('OpencodeDiscoverer', () => {
  it('discovers models from a successful opencode models', () => {
    const run: RunFn = () => OPENCODE_SAMPLE
    const d = new OpencodeDiscoverer(run)
    const caps = d.discover()
    expect(caps.agent).toBe('opencode')
    expect(caps.models.length).toBe(6)
    expect(caps.models).toContainEqual({ value: 'opencode-go/glm-5.2', label: 'glm-5.2' })
    expect(caps.defaultModel).toBeNull()
    expect(caps.controls).toEqual([])
  })

  it('falls back to empty models on a failed spawn', () => {
    const run: RunFn = () => null
    const d = new OpencodeDiscoverer(run)
    const caps = d.discover()
    expect(caps.models).toEqual([])
  })
})

describe('CodexDiscoverer', () => {
  it('returns an honest empty manifest (codex has no model list)', () => {
    const d = new CodexDiscoverer()
    expect(d.discover()).toEqual({ agent: 'codex', models: [], defaultModel: null, controls: [] })
  })
})
