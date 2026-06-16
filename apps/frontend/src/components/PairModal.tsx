import React from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useStore } from '../store'

interface Props {
  onClose: () => void
}

export function PairModal({ onClose }: Props): React.ReactElement {
  const tailscaleHost = useStore((s) => s.tailscaleHost)
  const token = localStorage.getItem('trux_token')
  const url =
    tailscaleHost && token
      ? `https://${tailscaleHost}/#token=${encodeURIComponent(token)}`
      : null

  return (
    <div className="pair-modal" data-testid="pair-modal">
      <div className="pair-card">
        {url ? (
          <>
            <p>Scan with your phone (must be on the tailnet):</p>
            <div className="pair-qr" data-testid="pair-qr">
              <QRCodeSVG value={url} size={240} />
            </div>
            <p className="hint">Opens trux already signed in — no token typing.</p>
          </>
        ) : (
          <p data-testid="pair-unavailable">
            Set <code>TRUX_TAILSCALE_HOST</code> and a bearer token to pair a phone.
          </p>
        )}
        <button data-testid="pair-close" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
