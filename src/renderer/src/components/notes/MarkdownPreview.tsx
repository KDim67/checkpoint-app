import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import MermaidChart from '../ui/MermaidChart'

interface MarkdownPreviewProps {
  content: string
  /** Opens (or creates) a note by title when a wiki-link is clicked. */
  onOpenWikiLink: (title: string) => void
  /** Returns true if a note with this title already exists (for broken-link styling). */
  noteExists: (title: string) => boolean
}

/**
 * Renders markdown with GFM, inline Mermaid diagrams, and clickable
 * `[[wiki-links]]` (with optional `[[Target|Alias]]` aliases).
 */
export default function MarkdownPreview({ content, onOpenWikiLink, noteExists }: MarkdownPreviewProps): React.JSX.Element {
  // Transform [[Target]] / [[Target|Alias]] into markdown links the parser understands.
  const processed = useMemo(() => {
    return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
      const t = target.trim()
      const label = (alias ?? target).trim()
      return `[${label}](#wiki-link-${encodeURIComponent(t)})`
    })
  }, [content])

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={url => url}
      components={{
        a: ({ href, children, ...props }) => {
          if (href && href.startsWith('#wiki-link-')) {
            const title = decodeURIComponent(href.replace('#wiki-link-', ''))
            const exists = noteExists(title)
            return (
              <a
                href="#"
                onClick={e => {
                  e.preventDefault()
                  onOpenWikiLink(title)
                }}
                title={exists ? `Open "${title}"` : `Create "${title}"`}
                style={{
                  color: exists ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                  textDecoration: exists ? 'none' : 'underline dotted',
                  fontWeight: 'var(--weight-semibold)',
                  background: exists ? 'var(--color-secondary-muted)' : 'transparent',
                  borderRadius: 'var(--radius-sm)',
                  padding: '0 3px',
                  cursor: 'pointer'
                }}
              >
                {children}
              </a>
            )
          }
          return (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }} {...props}>
              {children}
            </a>
          )
        },
        code: ({ className, children, ...props }) => {
          const isMermaid = /language-mermaid/.test(className || '')
          if (isMermaid) {
            return <MermaidChart code={String(children).trim()} />
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        }
      }}
    >
      {processed}
    </ReactMarkdown>
  )
}
