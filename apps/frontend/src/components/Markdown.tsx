import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Render assistant text as markdown. No raw HTML (react-markdown ignores it by
// default — safe against injection); GFM adds tables, strikethrough, task lists.
export function Markdown({ text }: { text: string }): React.ReactElement {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
