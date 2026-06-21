import { render, fireEvent, screen } from '@testing-library/react-native'

// Mock expo-router's useRouter (no real navigation in jest).
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), push: jest.fn() }),
}))

// Mock expo-camera: grant permissions and render a stub CameraView.
jest.mock('expo-camera', () => ({
  CameraView: () => null,
  useCameraPermissions: () => [
    { granted: true, status: 'granted', canAskAgain: true, expires: 'never' },
    jest.fn(() => Promise.resolve({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
    jest.fn(() => Promise.resolve({ granted: true, status: 'granted', canAskAgain: true, expires: 'never' })),
  ],
}))

// Mock expo-haptics (no native haptic engine in jest).
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  selectionAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}))

// Mock the ports module: keep parsePairQr real (pure logic), stub the
// side-effectful savePair / rebind / stored getters.
jest.mock('../src/ports', () => {
  const actual = jest.requireActual<typeof import('../src/ports')>('../src/ports')
  return {
    ...actual,
    savePair: jest.fn(),
    getStoredHost: jest.fn(() => null),
    getStoredToken: jest.fn(() => null),
  }
})

import PairScreen from '../app/pair'
import { savePair } from '../src/ports'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('PairScreen', () => {
  it('shows the Scan QR tab as the default mode', async () => {
    await render(<PairScreen />)
    expect(screen.getByText('Scan QR')).toBeTruthy()
    expect(screen.getByText('Paste URL')).toBeTruthy()
    // The paste-mode hint copy only appears in paste mode, so its absence here
    // confirms we landed on scan.
    expect(() => screen.getByText(/On this box, run/)).toThrow()
  })

  it('switches to paste mode, accepts a valid URL, and saves the pair', async () => {
    await render(<PairScreen />)
    await fireEvent.press(screen.getByText('Paste URL'))
    const input = screen.getByPlaceholderText('https://box.ts.net/#token=…')
    await fireEvent.changeText(input, 'https://box.tail123.ts.net/#token=abc123')
    await fireEvent.press(screen.getByText('Save & connect'))
    expect(savePair).toHaveBeenCalledWith('box.tail123.ts.net', 'abc123')
  })

  it('shows an error for a non-trux URL in paste mode and does not save', async () => {
    await render(<PairScreen />)
    await fireEvent.press(screen.getByText('Paste URL'))
    await fireEvent.changeText(
      screen.getByPlaceholderText('https://box.ts.net/#token=…'),
      'https://example.com/',
    )
    await fireEvent.press(screen.getByText('Save & connect'))
    expect(screen.getByText(/Paste the URL from `trux pair`/)).toBeTruthy()
    expect(savePair).not.toHaveBeenCalled()
  })
})
