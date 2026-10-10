/** a release's notes as written on GitHub; the text comes from the internet, so the default link check stays on and links open in the browser */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import * as appApi from '../../data/app'

const WEB = /^(https?:|mailto:)/i

export default function ReleaseNotesBody({ notes }: { notes: string }): React.JSX.Element {
  if (!notes.trim()) return <p className="release-notes-empty">No notes were written for this release.</p>
  return (
    <div className="markdown-body release-notes">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
