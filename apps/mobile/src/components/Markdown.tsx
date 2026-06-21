import { useState, Fragment } from 'react'
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { theme } from '../theme'
import { haptic } from '../haptics'

// Lightweight markdown renderer for assistant text. The PWA uses react-markdown
// (DOM-only); RN needs its own. This focuses on the elements that actually
// matter in agent output: fenced code blocks (with one-tap copy — manual
// multi-line selection is the worst interaction on a phone), inline `code`, and
// **bold**. Other prose renders as plain paragraphs. No raw HTML, so nothing to
// sanitize.

interface Block {
  type: 'code' | 'text'
  lang?: string
  content: string
}

// Split text into fenced code blocks vs prose. A fence is ``` optionally
// followed by a language, on its own line, closed by ```.
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.split('\n')
  let i = 0
  let prose: string[] = []
  const flushProse = (): void => {
    if (prose.length > 0) {
      const joined = prose.join('\n').replace(/^\n+|\n+$/g, '')
      if (joined) blocks.push({ type: 'text', content: joined })
      prose = []
    }
  }
  while (i < lines.length) {
    const fence = /^```(\w*)\s*$/.exec(lines[i])
    if (fence) {
      flushProse()
      const lang = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // skip closing fence (or past EOF)
      blocks.push({ type: 'code', lang, content: body.join('\n') })
    } else {
      prose.push(lines[i])
      i++
    }
  }
  flushProse()
  return blocks
}

// Render inline `code` and **bold** within a prose paragraph as styled spans.
function InlineText({ text }: { text: string }): React.ReactElement {
  // Tokenize on `code` and **bold**; everything else is plain.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter((p) => p !== '')
  return (
    <Text style={styles.paragraph}>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`')) {
          return <Text key={i} style={styles.inlineCode}>{p.slice(1, -1)}</Text>
        }
        if (p.startsWith('**') && p.endsWith('**')) {
          return <Text key={i} style={styles.bold}>{p.slice(2, -2)}</Text>
        }
        return <Fragment key={i}>{p}</Fragment>
      })}
    </Text>
  )
}

function CodeBlock({ lang, code }: { lang?: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void Clipboard.setStringAsync(code).then(() => {
      haptic('light')
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <View style={styles.codeBlock}>
      <View style={styles.codeHead}>
        <Text style={styles.codeLang}>{lang || 'text'}</Text>
        <Pressable onPress={copy} hitSlop={8} accessibilityLabel="Copy code">
          <Text style={[styles.codeCopy, copied && styles.codeCopied]}>{copied ? 'copied' : 'copy'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.codeScroll}>
        <Text style={styles.codeText}>{code}</Text>
      </ScrollView>
    </View>
  )
}

export function Markdown({ text }: { text: string }): React.ReactElement {
  const blocks = parseBlocks(text)
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) =>
        b.type === 'code' ? (
          <CodeBlock key={i} lang={b.lang} code={b.content} />
        ) : (
          <InlineText key={i} text={b.content} />
        ),
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  paragraph: { color: theme.text, fontSize: 15, fontFamily: theme.fontSans, lineHeight: 21 },
  bold: { fontFamily: `${theme.fontSans}-600`, fontWeight: '600' },
  inlineCode: {
    fontFamily: theme.fontMono,
    fontSize: 13,
    color: theme.accentBright,
    backgroundColor: theme.surface2,
  },
  codeBlock: {
    backgroundColor: theme.surface1,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radiusSm,
    overflow: 'hidden',
  },
  codeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.lineSoft,
    backgroundColor: theme.surface2,
  },
  codeLang: { color: theme.textFaint, fontSize: 11, fontFamily: theme.fontMono, textTransform: 'lowercase' },
  codeCopy: { color: theme.textDim, fontSize: 11, fontFamily: theme.fontMono },
  codeCopied: { color: theme.ok },
  codeScroll: { padding: 10 },
  codeText: { color: theme.text, fontSize: 13, lineHeight: 18, fontFamily: theme.fontMono },
})
