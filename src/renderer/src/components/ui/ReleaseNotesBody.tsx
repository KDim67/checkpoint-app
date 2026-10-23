/** a release's notes as written on GitHub; the text comes from the internet, so the default link check stays on and links open in the browser */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as appApi from '../../data/app'

const WEB = /^(https?:|mailto:)/i

type Level = 1 | 2 | 3 | 4 | 5 | 6

/** the notes' own ## sections become this level, so they sit under the heading around them rather than beside it */
function headingAt(level: Level, depth: number) {
  const Tag = `h${Math.min(6, level + Math.max(0, depth - 2))}` as 'h1'
  return function Heading({ children }: { children?: React.ReactNode }) {
    return <Tag>{children}</Tag>
  }
}

export default function ReleaseNotesBody({ notes, level = 3 }: { notes: string; level?: Level }): React.JSX.Element {
  if (!notes.trim()) return <p className="release-notes-empty">No notes were written for this release.</p>
  return (
    <div className="markdown-body release-notes">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: headingAt(level, 1),
          h2: headingAt(level, 2),
          h3: headingAt(level, 3),
          h4: headingAt(level, 4),
          h5: headingAt(level, 5),
          h6: headingAt(level, 6),
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={e => {
                e.preventDefault()
                if (href && WEB.test(href)) void appApi.openExternal(href)
              }}
            >
              {children}
            </a>
          )
        }}
      >
        {notes}
      </ReactMarkdown>
    </div>
  )
}

/** a date the way the release page shows it, empty when GitHub left it out */
export function releaseDate(publishedAt: string): string {
  const time = Date.parse(publishedAt)
  return Number.isFinite(time) ? new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}
