import QRCode from 'qrcode'

/** Render a QR as braille cells (2×4 modules per character) — roughly half the height of qrcode-terminal `small`. */
export function renderBrailleQr(text: string, errorCorrectionLevel: 'L' | 'M' = 'L'): string {
  const qr = QRCode.create(text, { errorCorrectionLevel })
  const size = qr.modules.size
  const lines: string[] = []
  for (let y = 0; y < size; y += 4) {
    let line = ''
    for (let x = 0; x < size; x += 2) {
      let bits = 0
      // Unicode braille dots: (dy,dx) → bit
      // 1 4
      // 2 5
      // 3 6
      // 7 8
      const map: Array<[number, number, number]> = [
        [0, 0, 0x01],
        [1, 0, 0x02],
        [2, 0, 0x04],
        [0, 1, 0x08],
        [1, 1, 0x10],
        [2, 1, 0x20],
        [3, 0, 0x40],
        [3, 1, 0x80],
      ]
      for (const [dy, dx, bit] of map) {
        const yy = y + dy
        const xx = x + dx
        if (yy < size && xx < size && qr.modules.get(xx, yy)) bits |= bit
      }
      line += String.fromCharCode(0x2800 + bits)
    }
    lines.push(line)
  }
  return lines.join('\n')
}
