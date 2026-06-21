import { render, screen } from '@testing-library/react-native'

// Mock expo-router's useRouter so the screen doesn't need a navigation context.
const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockBack = jest.fn()
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  Redirect: () => null,
  Stack: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock safe-area-context to avoid needing the provider.
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}))

// Mock haptics
jest.mock('../../src/haptics', () => ({ haptic: jest.fn() }))

import SettingsScreen from './settings'

describe('SettingsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows the current paired host', async () => {
    await render(<SettingsScreen />)
    // The host label should appear
    expect(screen.getByText('Host')).toBeTruthy()
    expect(screen.getByText('Token')).toBeTruthy()
  })

  it('has a switch host / re-pair button', async () => {
    await render(<SettingsScreen />)
    expect(screen.getByText('Switch host / re-pair')).toBeTruthy()
  })
})
