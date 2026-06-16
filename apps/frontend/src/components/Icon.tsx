// Minimal stroke icons (no emoji) — inherit currentColor.
interface Props {
  name: 'send' | 'stop' | 'attach' | 'bookmark' | 'list' | 'phone'
  size?: number
}

const PATHS: Record<Props['name'], React.ReactNode> = {
  send: <path d="M7 11L12 6L17 11M12 6V18" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  attach: <path d="M19 11l-7.5 7.5a4 4 0 01-5.7-5.7L13 5.6a2.5 2.5 0 013.5 3.5L9 16.6a1 1 0 01-1.4-1.4l6.6-6.6" />,
  bookmark: <path d="M6 4h12v16l-6-4-6 4V4z" />,
  list: <path d="M8 7h11M8 12h11M8 17h11M4 7h.01M4 12h.01M4 17h.01" />,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></>,
}

export function Icon({ name, size = 20 }: Props): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
