import { describe, expect, it, vi } from 'vitest'
import { buildOpenUrl, buildAccessUrl, buildPairUrl } from '../src/banner'
import { runOpen, type OpenDeps } from '../src/cli'
import type { Config } from '../src/config'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const base: Config = {
  host: '127.0.0.1',
  port: 4317,
  dbPath: ':memory:',
  secret: 'deadbeef',
  authRequired: true,
  workspaceRoots: [],
  tailscaleHost: 'box.tail.ts.net',
  publicHost: null,
  pushPrivacy: false,
}

describe('URL builders', () => {
  it('buildOpenUrl includes the token fragment', () => {
    expect(buildOpenUrl(base)).toBe('http://localhost:4317/#token=deadbeef')
    expect(buildOpenUrl({ ...base, secret: null })).toBe('http://localhost:4317/')
  })

  it('buildAccessUrl prefers publicHost then tailscaleHost', () => {
    expect(buildAccessUrl(base)).toBe('https://box.tail.ts.net/')
    expect(buildAccessUrl({ ...base, publicHost: 'app.fly.dev' })).toBe('https://app.fly.dev/')
    expect(buildAccessUrl({ ...base, publicHost: null, tailscaleHost: null })).toBe(
      'http://localhost:4317/',
    )
  })

  it('buildPairUrl writes a short /p/<code> URL', () => {
    const home = mkdtempSync(join(tmpdir(), 'trux-cli-'))
    try {
      const url = buildPairUrl({ ...base, publicHost: 'pc.tail.ts.net' }, home)
      expect(url).toMatch(/^https:\/\/pc\.tail\.ts\.net\/p\/[0-9A-HJKMNP-TV-Z]{8}$/)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})

describe('runOpen', () => {
  it('starts the service when inactive, waits for health, opens the browser', async () => {
    const opened: string[] = []
    const logs: string[] = []
    const deps: OpenDeps = {
      hasSystemd: () => true,
      isServiceActive: () => false,
      startService: vi.fn(),
      waitForHealth: async () => true,
      openBrowser: (url) => {
        opened.push(url)
        return true
      },
      log: (m) => logs.push(m),
      error: (m) => logs.push(m),
    }
    const code = await runOpen(base, deps)
    expect(code).toBe(0)
    expect(deps.startService).toHaveBeenCalled()
    expect(opened).toEqual(['http://localhost:4317/#token=deadbeef'])
    expect(logs.some((l) => l.includes('opening'))).toBe(true)
  })

  it('fails when health never comes up', async () => {
    const errors: string[] = []
    const code = await runOpen(base, {
      hasSystemd: () => false,
      isServiceActive: () => false,
      startService: () => {},
      waitForHealth: async () => false,
      openBrowser: () => false,
      log: () => {},
      error: (m) => errors.push(m),
    })
    expect(code).toBe(1)
    expect(errors[0]).toMatch(/not healthy/)
  })
})
