import { describe, it, expect, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { registerAuth } from '../src/auth-route'
import type { Authenticator, AuthMode, AuthStatus } from '../src/auth-provider'
import type { Config } from '../src/config'

const config = { authRequired: false, secret: null } as unknown as Config

class FakeAuth implements Authenticator {
  readonly id = 'codex'
  readonly plane = 'model' as const
  begun = false
  begin(): Promise<AuthMode> {
    this.begun = true
    return Promise.resolve({ mode: 'device', verifyUrl: 'https://x/dev', userCode: 'AAAA-1111' })
  }
  poll(): Promise<AuthStatus> { return Promise.resolve('pending') }
  status(): Promise<AuthStatus> { return Promise.resolve('connected') }
  disconnect(): Promise<void> { return Promise.resolve() }
  submitKey(key: string): Promise<AuthStatus> { return Promise.resolve(key === 'good' ? 'connected' : 'disconnected') }
  submitCode(code: string): Promise<AuthStatus> { return Promise.resolve(code === 'good' ? 'connected' : 'disconnected') }
}

let app: FastifyInstance
let fake: FakeAuth
beforeEach(async () => {
  app = Fastify()
  fake = new FakeAuth()
  registerAuth(app, config, new Map<string, Authenticator>([['codex', fake]]))
  await app.ready()
})

describe('auth routes', () => {
  it('begin returns the device mode', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/codex/begin' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ mode: 'device', verifyUrl: 'https://x/dev', userCode: 'AAAA-1111' })
    expect(fake.begun).toBe(true)
  })
  it('unknown provider is 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/nope/begin' })
    expect(res.statusCode).toBe(400)
  })
  it('poll/status return the lifecycle status', async () => {
    expect((await app.inject({ method: 'GET', url: '/auth/codex/poll' })).json()).toEqual({ status: 'pending' })
    expect((await app.inject({ method: 'GET', url: '/auth/codex/status' })).json()).toEqual({ status: 'connected' })
  })
  it('key fallback validates and maps the result', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/codex/key', payload: { key: 'good' } })).json()).toEqual({ status: 'connected' })
    expect((await app.inject({ method: 'POST', url: '/auth/codex/key', payload: {} })).statusCode).toBe(400)
  })
  it('code step validates and maps the result', async () => {
    expect((await app.inject({ method: 'POST', url: '/auth/codex/code', payload: { code: 'good' } })).json()).toEqual({ status: 'connected' })
    expect((await app.inject({ method: 'POST', url: '/auth/codex/code', payload: {} })).statusCode).toBe(400)
  })
})
