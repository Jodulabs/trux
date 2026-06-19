import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from './Icon'
import { haptic } from '../haptics'

// A fenced code block with a header strip: language label + one-tap copy. Manual
// multi-line selection on a phone is the worst interaction in a coding tool, so
// the copy button carries it. Copy flashes in copper + fires a light haptic.
function CodeBlock({ language, code }: { language: string; code: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        haptic('light')
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      })
      .catch(() => {
        // clipboard denied/unavailable — leave the button in its idle state
      })
  }
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span className="codeblock-lang">{language || 'text'}</span>
        <button
          className={`codeblock-copy${copied ? ' copied' : ''}`}
          data-testid="code-copy"
          onClick={copy}
          aria-label="Copy code"
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} />
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  )
}

// Render assistant text as markdown. No raw HTML (react-markdown ignores it by
// default — safe against injection); GFM adds tables, strikethrough, task lists.
// `pre` collapses to a fragment so fenced blocks render as our CodeBlock with no
// nested <pre>; inline code stays a plain <code>.
export function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className ?? '')
            const body = String(children ?? '').replace(/\n$/, '')
            if (match || body.includes('\n')) {
              return <CodeBlock language={match?.[1] ?? ''} code={body} />
            }
            return <code className={className} {...props}>{children}</code>
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
