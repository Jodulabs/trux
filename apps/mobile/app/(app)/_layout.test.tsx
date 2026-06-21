import { render } from '@testing-library/react-native'
import { useStore } from '@trux/client/store'

// Capture the Redirect href so we can assert the gate blocks vs admits.
let mockRedirectHref: string | null = null
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => {
    mockRedirectHref = props.href
    return null
  },
  Stack: (props: { children?: React.ReactNode }) => props.children ?? null,
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), push: jest.fn() }),
}))

// Mock the ports so we can control whether a host+token are present.
jest.mock('../../src/ports', () => ({
  getStoredHost: jest.fn(() => null),
  getStoredToken: jest.fn(() => null),
}))

// Stub native push so the authed shell's registration effect is inert in tests.
jest.mock('../../src/notifications', () => ({
  configureNotificationHandler: jest.fn(),
  registerForPushAsync: jest.fn(() => Promise.resolve(null)),
  addNotificationResponseListener: jest.fn(() => () => {}),
  consumeInitialNotificationResponse: jest.fn(() => Promise.resolve()),
}))

import AppLayout from './_layout'
import { getStoredHost, getStoredToken } from '../../src/ports'

beforeEach(() => {
  jest.clearAllMocks()
  mockRedirectHref = null
  useStore.setState({ conversations: [], convMeta: {} })
})

describe('(app) gate', () => {
  it('redirects to /pair when no host + token are stored', async () => {
    ;(getStoredHost as jest.Mock).mockReturnValue(null)
    ;(getStoredToken as jest.Mock).mockReturnValue(null)
    await render(<AppLayout />)
    expect(mockRedirectHref).toBe('/pair')
  })

  it('admits into the shell when both host + token are present', async () => {
    ;(getStoredHost as jest.Mock).mockReturnValue('box.ts.net')
    ;(getStoredToken as jest.Mock).mockReturnValue('secret')
    await render(<AppLayout />)
    expect(mockRedirectHref).toBeNull()
  })

  it('blocks when only a host is present (token missing)', async () => {
    ;(getStoredHost as jest.Mock).mockReturnValue('box.ts.net')
    ;(getStoredToken as jest.Mock).mockReturnValue(null)
    await render(<AppLayout />)
    expect(mockRedirectHref).toBe('/pair')
  })
})
