import { afterEach, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'
import type { ServerEvent } from '@trux/protocol'
import { buildServer } from '../src/server'
import { openDb, type TruxDatabase } from '../src/db'
import type { Config } from '../src/config'

const baseConfig: Config = {
  host: '127.0.0.1',
  port: 0,
  dbPath: ':memory:',
  secret: 'test-secret',
  authRequired: true,
  workspaceRoots: [],
}

let app: FastifyInstance
let db: TruxDatabase

async function listen(config: Config): Promise<number> {
  db = openDb(':memory:')
  app = await buildServer(config, db)
  await app.listen({ host: '127.0.0.1', port: 0 })
  return (app.server.address() as AddressInfo).port
}

// Open a WS, send the given raw first frame, resolve with the first server event received.
function firstEventRaw(port: number, firstFrame: string): Promise<ServerEvent> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/conversations/dev/stream`)
    ws.on('open', () => ws.send(firstFrame))
    ws.on('message', (raw) => {
      resolve(JSON.parse(raw.toString()) as ServerEvent)
      ws.close()
    })
    ws.on('error', reject)
  })
}

function firstEvent(port: number, firstFrame: unknown): Promise<ServerEvent> {
  return firstEventRaw(port, JSON.stringify(firstFrame))
}

afterEach(async () => {
  await app?.close()
  db?.close()
})

describe('buildServer websocket', () => {
  it('replies with a hello event after a valid auth frame', async () => {
    const port = await listen(baseConfig)
    const event = await firstEvent(port, { type: 'auth', token: 'test-secret' })
    expect(event).toEqual({ type: 'hello', protocol_version: 1, server: 'trux' })
  })

  it('rejects a wrong token with an error event', async () => {
    const port = await listen(baseConfig)
    const event = await firstEvent(port, { type: 'auth', token: 'wrong' })
    expect(event.type).toBe('error')
  })

  it('rejects a non-auth first frame with an error event', async () => {
    const port = await listen(baseConfig)
    const event = await firstEvent(port, { type: 'interrupt' })
    expect(event.type).toBe('error')
  })

  it('returns a recoverable error for a malformed frame', async () => {
    const port = await listen(baseConfig)
    const event = await firstEventRaw(port, '{not json')
    expect(event).toEqual({ type: 'error', message: 'invalid message', recoverable: true })
  })

  it('serves a health endpoint backed by the db', async () => {
    const port = await listen(baseConfig)
    const res = await fetch(`http://127.0.0.1:${port}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, conversations: 0 })
  })
})
