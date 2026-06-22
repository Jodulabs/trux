import type { FastifyInstance } from 'fastify'
import http from 'node:http'
import net from 'node:net'
import type { Socket } from 'node:net'
import type { Config } from './config'
import { tokenAccepted } from './auth'

// --- Web preview reverse proxy -------------------------------------------------
//
// Serves a dev server running on 127.0.0.1:<port> (on the box) at
//   /__preview__/<port>/…
// on trux's single authenticated origin (:4317). The phone/web can then open the
// app the agent is building, with HMR, through one token-gated origin — no extra
// ports exposed (Tailscale/Fly only expose 4317).
//
// The port itself is detected elsewhere (ports.ts → manager `port_detected` →
// spine `previewPort`). This module is the ACCESS half only.

const PREVIEW_PREFIX = '/__preview__/'
const COOKIE_NAME = 'trux_preview'

// Hop-by-hop headers must not be forwarded across a proxy (RFC 7230 §6.1).
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

// --- Pure helpers (unit-tested without a live server) -------------------------

export interface PreviewPath {
  port: number
  rest: string // path remainder incl. leading '/', plus original query string
}

// Parse `/__preview__/<port><rest?query>` → {port, rest}. Returns null on a
// non-preview URL or an out-of-range/garbage port. `rest` defaults to '/'.
export function parsePreviewPath(url: string): PreviewPath | null {
  if (!url.startsWith(PREVIEW_PREFIX)) return null
  const afterPrefix = url.slice(PREVIEW_PREFIX.length)
  // Split the port segment off the first '/' (or end of string).
  const slash = afterPrefix.indexOf('/')
  const portStr = slash === -1 ? afterPrefix : afterPrefix.slice(0, slash)
  // A bare `/__preview__/<port>` (no trailing slash) may still carry a query.
  const q = portStr.indexOf('?')
  const cleanPortStr = q === -1 ? portStr : portStr.slice(0, q)
  if (!/^\d+$/.test(cleanPortStr)) return null
  const port = Number(cleanPortStr)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  let rest: string
  if (slash === -1) {
    // No path after the port; keep any query that trailed the bare form.
    rest = q === -1 ? '/' : '/' + portStr.slice(q)
  } else {
    rest = afterPrefix.slice(slash)
  }
  if (rest === '') rest = '/'
  return { port, rest }
}

// Insert `<base href="/__preview__/<port>/">` so relative-path apps resolve
// through the proxy. After the first <head> (case-insensitive); fallback after
// the opening <html…> tag; final fallback prepend.
export function injectBaseTag(html: string, port: number): string {
  const baseTag = `<base href="${PREVIEW_PREFIX}${port}/">`
  const headMatch = /<head[^>]*>/i.exec(html)
  if (headMatch) {
    const at = headMatch.index + headMatch[0].length
    return html.slice(0, at) + baseTag + html.slice(at)
  }
  const htmlMatch = /<html[^>]*>/i.exec(html)
  if (htmlMatch) {
    const at = htmlMatch.index + htmlMatch[0].length
    return html.slice(0, at) + baseTag + html.slice(at)
  }
  return baseTag + html
}

// Read the trux_preview cookie value out of a Cookie header.
export function readPreviewCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === COOKIE_NAME) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export type PreviewAuthAction = 'pass' | 'setCookieRedirect' | 'reject'
export interface PreviewAuthResult {
  action: PreviewAuthAction
  token?: string
}

// Decide how to handle a preview request's auth:
//   valid ?__trux_token  → set the cookie + redirect (strip token from URL)
//   valid trux_preview cookie → pass
//   otherwise → reject (401)
// When config.authRequired is false, tokenAccepted is true for anything, so a
// cookie-less local request still passes via the queryToken path or the cookie
// path — to make local "just work" with no token at all, we also pass when
// auth is not required.
export function previewAuthDecision(args: {
  cookie: string | null
  queryToken: string | null
  config: Config
}): PreviewAuthResult {
  const { cookie, queryToken, config } = args
  // A token on the URL takes precedence: validate, set cookie, strip it.
  if (queryToken !== null) {
    if (tokenAccepted(config, queryToken)) return { action: 'setCookieRedirect', token: queryToken }
    return { action: 'reject' }
  }
  if (cookie !== null && tokenAccepted(config, cookie)) return { action: 'pass' }
  // No cookie, no token: only allowed when auth is off (local dev).
  if (!config.authRequired) return { action: 'pass' }
  return { action: 'reject' }
}

// Strip `?__trux_token=…` from a preview URL, preserving any other query params.
export function stripTokenFromUrl(url: string): string {
  const qIndex = url.indexOf('?')
  if (qIndex === -1) return url
  const path = url.slice(0, qIndex)
  const params = new URLSearchParams(url.slice(qIndex + 1))
  params.delete('__trux_token')
  const rest = params.toString()
  return rest ? `${path}?${rest}` : path
}

// --- Header plumbing ----------------------------------------------------------

function filterRequestHeaders(headers: http.IncomingHttpHeaders, port: number): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {}
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase()
    if (HOP_BY_HOP.has(lk)) continue
    if (lk === 'host') continue
    if (lk.startsWith('proxy-')) continue
    if (v !== undefined) out[k] = v
  }
  out.host = `127.0.0.1:${port}`
  return out
}

function filterResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {}
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase()
    if (HOP_BY_HOP.has(lk)) continue
    if (lk.startsWith('proxy-')) continue
    if (v !== undefined) out[k] = v
  }
  return out
}

// --- Fastify registration -----------------------------------------------------

export function registerPreview(app: FastifyInstance, config: Config): void {
  // The preview route is registered at app level (like registerStream /
  // registerTerminal), NOT inside the registerRoutes scope, so the REST bearer
  // preHandler never runs on it — preview uses cookie-or-token auth instead.
  // We disable Fastify's body parsing for these routes and proxy the raw stream.

  const handler = (
    req: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ): void => {
    const raw = req.raw
    const url = raw.url ?? ''
    const parsed = parsePreviewPath(url)
    if (!parsed) {
      reply.code(400).send('bad preview path')
      return
    }
    const { port, rest } = parsed

    // --- auth ---
    const query = req.query as Record<string, string | undefined>
    const queryToken = typeof query.__trux_token === 'string' ? query.__trux_token : null
    const cookie = readPreviewCookie(raw.headers.cookie)
    const decision = previewAuthDecision({ cookie, queryToken, config })

    if (decision.action === 'reject') {
      reply.code(401).send('unauthorized')
      return
    }
    if (decision.action === 'setCookieRedirect') {
      const stripped = stripTokenFromUrl(url)
      reply
        .header(
          'set-cookie',
          `${COOKIE_NAME}=${encodeURIComponent(decision.token!)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`,
        )
        .code(302)
        .header('location', stripped)
        .send()
      return
    }

    // --- proxy ---
    proxyHttp(req, reply, port, rest)
  }

  // Encapsulated scope so (a) the REST bearer preHandler from registerRoutes
  // never applies here, and (b) a passthrough content-type parser stays local:
  // we proxy the body off req.raw directly, so Fastify must NOT consume it.
  app.register(async (scope) => {
    scope.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined))
    scope.route({
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      url: '/__preview__/:port/*',
      handler,
    })
    scope.route({
      method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      url: '/__preview__/:port',
      handler,
    })
  })

  // --- WS-upgrade passthrough for HMR -----------------------------------------
  // @fastify/websocket already attached an 'upgrade' listener (terminal/stream).
  // We add OUR OWN listener that handles ONLY /__preview__/<port>/… upgrades and
  // returns (without destroying the socket) for everything else, so the
  // @fastify/websocket handler still processes terminal/stream upgrades.
  //
  // NOTE: handler-ordering vs @fastify/websocket must be confirmed at integration
  // time. Node fires 'upgrade' listeners in registration order; both run unless
  // one ends the socket. We only ever touch preview URLs, and @fastify/websocket
  // only touches its registered routes, so they don't collide — but this is the
  // one seam that needs hands-on verification (see report).
  app.server.on('upgrade', (req, socket: Socket, head: Buffer) => {
    const url = req.url ?? ''
    const parsed = parsePreviewPath(url)
    if (!parsed) return // not ours — let @fastify/websocket handle it
    const { port, rest } = parsed

    // Same-origin upgrade carries the cookie; validate it.
    const cookie = readPreviewCookie(req.headers.cookie)
    if (config.authRequired && !tokenAccepted(config, cookie)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    // Dial the upstream dev server and replay the raw upgrade request.
    const upstream = net.connect(port, '127.0.0.1', () => {
      const headerLines = [`${req.method} ${rest} HTTP/1.1`]
      const h = filterRequestHeaders(req.headers, port)
      // Re-add the upgrade/connection headers stripped by the hop-by-hop filter:
      // a WS handshake needs them verbatim.
      h.connection = req.headers.connection ?? 'Upgrade'
      h.upgrade = req.headers.upgrade ?? 'websocket'
      for (const [k, v] of Object.entries(h)) {
        if (Array.isArray(v)) for (const item of v) headerLines.push(`${k}: ${item}`)
        else if (v !== undefined) headerLines.push(`${k}: ${String(v)}`)
      }
      upstream.write(headerLines.join('\r\n') + '\r\n\r\n')
      if (head && head.length) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })
}

// Proxy a normal (non-upgrade) HTTP request to 127.0.0.1:<port>.
function proxyHttp(
  req: import('fastify').FastifyRequest,
  reply: import('fastify').FastifyReply,
  port: number,
  rest: string,
): void {
  const raw = req.raw
  const headers = filterRequestHeaders(raw.headers, port)

  const upstreamReq = http.request(
    { host: '127.0.0.1', port, method: raw.method, path: rest, headers },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502
      const resHeaders = filterResponseHeaders(upstreamRes.headers)
      const ct = String(upstreamRes.headers['content-type'] ?? '')

      if (ct.includes('text/html')) {
        // Buffer so we can inject <base> and fix content-length.
        const chunks: Buffer[] = []
        upstreamRes.on('data', (c: Buffer) => chunks.push(c))
        upstreamRes.on('end', () => {
          const body = injectBaseTag(Buffer.concat(chunks).toString('utf8'), port)
          const buf = Buffer.from(body, 'utf8')
          delete resHeaders['content-length']
          resHeaders['content-length'] = String(buf.length)
          // content-encoding stays as-is only if upstream didn't compress; vite
          // dev serves HTML uncompressed, so this is safe in practice.
          reply.code(status).headers(resHeaders).send(buf)
        })
        upstreamRes.on('error', () => {
          if (!reply.sent) reply.code(502).send(`dev server on :${port} not reachable`)
        })
        return
      }

      // Non-HTML: stream straight through.
      reply.code(status).headers(resHeaders).send(upstreamRes)
    },
  )

  upstreamReq.on('error', (err: NodeJS.ErrnoException) => {
    if (reply.sent) return
    const why = err.code === 'ECONNREFUSED' ? 'not running' : (err.code ?? 'unreachable')
    reply.code(502).send(`dev server on :${port} not reachable (${why})`)
  })

  // Pipe the request body through (POST/PUT/etc).
  raw.pipe(upstreamReq)
}
