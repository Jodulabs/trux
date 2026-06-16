// Detect a local dev-server port from agent output (the design's "trux detects"
// path). Matches http://localhost:PORT, http://127.0.0.1:PORT, or bare host:PORT.
const PORT_RE = /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1):(\d{2,5})/

export function detectPort(text: string): number | null {
  const m = PORT_RE.exec(text)
  if (!m) return null
  const port = Number(m[1])
  return port >= 1 && port <= 65535 ? port : null
}
