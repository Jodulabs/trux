import { AppState } from 'react-native'
import { useStore } from '@trux/client/store'

// --- Mocks -------------------------------------------------------------------
// expo-notifications: jest.fn()s created inside the factory (so they exist at
// factory-eval time, before module-scope consts initialize), then grabbed via
// the import below to configure per-test.
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
}))

// expo-constants default export — projectId comes from extra.eas.projectId.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-123' } } } },
}))

jest.mock('./ports', () => ({
  getStoredHost: jest.fn(() => 'box.ts.net'),
  getStoredToken: jest.fn(() => 'secret'),
}))

jest.mock('@trux/client/api', () => ({
  api: { subscribeExpoPush: jest.fn(() => Promise.resolve({ ok: true })) },
}))

import * as Notifications from 'expo-notifications'
import { api } from '@trux/client/api'
import { getStoredHost, getStoredToken } from './ports'
import {
  configureNotificationHandler,
  registerForPushAsync,
  addNotificationResponseListener,
  consumeInitialNotificationResponse,
} from './notifications'

const mockNotif = Notifications as jest.Mocked<typeof Notifications>
const mockApi = api as unknown as { subscribeExpoPush: jest.Mock }
const mockHost = getStoredHost as jest.Mock
const mockToken = getStoredToken as jest.Mock

// A minimal notification carrying trux's data payload.
function notification(data: Record<string, unknown>) {
  return { request: { content: { data } } } as unknown as Notifications.Notification
}

beforeEach(() => {
  jest.clearAllMocks()
  mockHost.mockReturnValue('box.ts.net')
  mockToken.mockReturnValue('secret')
  useStore.setState({ currentId: null })
  ;(AppState as { currentState: string }).currentState = 'active'
})

describe('registerForPushAsync', () => {
  it('registers the token with the box when paired and permission granted', async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true } as never)
    mockNotif.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' } as never)
    const token = await registerForPushAsync()
    expect(token).toBe('ExponentPushToken[abc]')
    expect(mockApi.subscribeExpoPush).toHaveBeenCalledWith('ExponentPushToken[abc]')
    // projectId from expo-constants is forwarded.
    expect(mockNotif.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-123' })
  })

  it('no-ops (no permission prompt, no register) when not yet paired', async () => {
    mockHost.mockReturnValue(null)
    const token = await registerForPushAsync()
    expect(token).toBeNull()
    expect(mockNotif.getPermissionsAsync).not.toHaveBeenCalled()
    expect(mockApi.subscribeExpoPush).not.toHaveBeenCalled()
  })

  it('requests permission when not already granted', async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: 'undetermined', granted: false } as never)
    mockNotif.requestPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true } as never)
    mockNotif.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[x]' } as never)
    const token = await registerForPushAsync()
    expect(mockNotif.requestPermissionsAsync).toHaveBeenCalled()
    expect(token).toBe('ExponentPushToken[x]')
  })

  it('returns null and does not register when permission is denied', async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false } as never)
    mockNotif.requestPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false } as never)
    const token = await registerForPushAsync()
    expect(token).toBeNull()
    expect(mockNotif.getExpoPushTokenAsync).not.toHaveBeenCalled()
    expect(mockApi.subscribeExpoPush).not.toHaveBeenCalled()
  })

  it('degrades to null when token acquisition throws', async () => {
    mockNotif.getPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true } as never)
    mockNotif.getExpoPushTokenAsync.mockRejectedValue(new Error('no projectId'))
    const token = await registerForPushAsync()
    expect(token).toBeNull()
    expect(mockApi.subscribeExpoPush).not.toHaveBeenCalled()
  })
})

describe('configureNotificationHandler (foreground suppression)', () => {
  // Invoke the handler that was registered with expo-notifications.
  async function runHandler(data: Record<string, unknown>) {
    configureNotificationHandler()
    const handler = mockNotif.setNotificationHandler.mock.calls[0][0]!
    return handler.handleNotification(notification(data))
  }

  it('suppresses the banner when foregrounded on that exact conversation', async () => {
    useStore.setState({ currentId: 'c1' })
    const behaviour = await runHandler({ conversationId: 'c1', kind: 'turn' })
    expect(behaviour.shouldShowBanner).toBe(false)
    expect(behaviour.shouldPlaySound).toBe(false)
  })

  it('shows the banner when focused on a different conversation', async () => {
    useStore.setState({ currentId: 'other' })
    const behaviour = await runHandler({ conversationId: 'c1', kind: 'turn' })
    expect(behaviour.shouldShowBanner).toBe(true)
  })

  it('shows the banner when the app is backgrounded even if it is the current conversation', async () => {
    useStore.setState({ currentId: 'c1' })
    ;(AppState as { currentState: string }).currentState = 'background'
    const behaviour = await runHandler({ conversationId: 'c1', kind: 'turn' })
    expect(behaviour.shouldShowBanner).toBe(true)
  })
})

describe('addNotificationResponseListener (deep-link on tap)', () => {
  it('navigates to the tapped conversation and unsubscribes on teardown', () => {
    let captured: ((r: unknown) => void) | null = null
    const remove = jest.fn()
    mockNotif.addNotificationResponseReceivedListener.mockImplementation((cb) => {
      captured = cb as (r: unknown) => void
      return { remove } as never
    })
    const navigate = jest.fn()
    const unsubscribe = addNotificationResponseListener(navigate)
    captured!({ notification: notification({ conversationId: 'c9', kind: 'approval' }) })
    expect(navigate).toHaveBeenCalledWith('c9')
    unsubscribe()
    expect(remove).toHaveBeenCalled()
  })

  it('ignores a response with no conversationId', () => {
    let captured: ((r: unknown) => void) | null = null
    mockNotif.addNotificationResponseReceivedListener.mockImplementation((cb) => {
      captured = cb as (r: unknown) => void
      return { remove: jest.fn() } as never
    })
    const navigate = jest.fn()
    addNotificationResponseListener(navigate)
    captured!({ notification: notification({}) })
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('consumeInitialNotificationResponse (cold start)', () => {
  it('deep-links from the launch notification when present', async () => {
    mockNotif.getLastNotificationResponseAsync.mockResolvedValue({
      notification: notification({ conversationId: 'cold' }),
    } as never)
    const navigate = jest.fn()
    await consumeInitialNotificationResponse(navigate)
    expect(navigate).toHaveBeenCalledWith('cold')
  })

  it('does nothing when there is no launch notification', async () => {
    mockNotif.getLastNotificationResponseAsync.mockResolvedValue(null as never)
    const navigate = jest.fn()
    await consumeInitialNotificationResponse(navigate)
    expect(navigate).not.toHaveBeenCalled()
  })
})
