import { render, screen, fireEvent } from '@testing-library/react-native'

const mockSetString = jest.fn((_s: string) => Promise.resolve())
jest.mock('expo-clipboard', () => ({ setStringAsync: (s: string) => mockSetString(s) }))
jest.mock('../haptics', () => ({ haptic: jest.fn() }))

import { Markdown, parseBlocks } from './Markdown'

describe('parseBlocks', () => {
  it('splits prose and fenced code blocks', () => {
    const blocks = parseBlocks('Intro line\n```ts\nconst x = 1\n```\nOutro line')
    expect(blocks).toEqual([
      { type: 'text', content: 'Intro line' },
      { type: 'code', lang: 'ts', content: 'const x = 1' },
      { type: 'text', content: 'Outro line' },
    ])
  })

  it('treats text with no fences as a single prose block', () => {
    expect(parseBlocks('just some words')).toEqual([{ type: 'text', content: 'just some words' }])
  })

  it('handles a code block with no language', () => {
    const blocks = parseBlocks('```\nplain\n```')
    expect(blocks).toEqual([{ type: 'code', lang: '', content: 'plain' }])
  })

  it('tolerates an unclosed fence (consumes to end)', () => {
    const blocks = parseBlocks('```js\nlet a = 2')
    expect(blocks).toEqual([{ type: 'code', lang: 'js', content: 'let a = 2' }])
  })
})

describe('Markdown', () => {
  it('renders prose and a code block with its language label', async () => {
    await render(<Markdown text={'Hello there\n```py\nprint(1)\n```'} />)
    expect(screen.getByText('Hello there')).toBeTruthy()
    expect(screen.getByText('print(1)')).toBeTruthy()
    expect(screen.getByText('py')).toBeTruthy()
  })

  it('copies the code to the clipboard when copy is pressed', async () => {
    await render(<Markdown text={'```\nnpm install\n```'} />)
    await fireEvent.press(screen.getByText('copy'))
    expect(mockSetString).toHaveBeenCalledWith('npm install')
  })
})
