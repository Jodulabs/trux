// QR pairing: a phone scans a QR encoding `https://<host>.ts.net/#token=<bearer>`.
// Reads the token from the URL *fragment* (never sent to the server / access logs),
// stores it, and strips the fragment from the visible URL.
export function consumePairingToken(loc: Location = window.location): string | null {
  const m = /[#&]token=([^&]+)/.exec(loc.hash)
  if (!m) return null
  const token = decodeURIComponent(m[1])
  localStorage.setItem('trux_token', token)
  window.history.replaceState(null, '', loc.pathname + loc.search)
  return token
}
