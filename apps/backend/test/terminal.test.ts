import { describe, it, expect } from 'vitest'
import { TerminalSession, type PtyLike, type SpawnPty } from '../src/terminal'

function fakePty() {
  let dataCb: ((d: string) => void) | null = null
  let exitCb: ((e: { exitCode: number }) => void) | null = null
  const calls = { writes: [] as string[], resized: null as [number, number] | null, killed: false }
  const pty: PtyLike = {
    onData: (cb) => { dataCb = cb },
    onExit: (cb) => { exitCb = cb },
    write: (d) => calls.writes.push(d),
    resize: (c, r) => { calls.resized = [c, r] },
    kill: () => { calls.killed = true },
  }
  return { pty, calls, emitData: (d: string) => dataCb?.(d), emitExit: (code: number) => exitCb?.({ exitCode: code }) }
}

describe('TerminalSession', () => {
  it('spawns in the given cwd+size and bridges data/exit/write/resize/kill', () => {
    const f = fakePty()
    let spawnedWith: { cwd: string; cols: number; rows: number } | null = null
    const spawnPty: SpawnPty = (opts) => { spawnedWith = opts; return f.pty }

    const session = new TerminalSession('/work/dir', spawnPty, { cols: 100, rows: 30 })
    expect(spawnedWith).toEqual({ cwd: '/work/dir', cols: 100, rows: 30 })

    const out: string[] = []
    session.onData((d) => out.push(d))
    f.emitData('hello')
    expect(out).toEqual(['hello'])

    let exited: number | null = null
    session.onExit((code) => { exited = code })
    f.emitExit(0)
    expect(exited).toBe(0)

    session.write('ls\n')
    expect(f.calls.writes).toEqual(['ls\n'])
    session.resize(120, 40)
    expect(f.calls.resized).toEqual([120, 40])
    session.kill()
    expect(f.calls.killed).toBe(true)
  })
})
