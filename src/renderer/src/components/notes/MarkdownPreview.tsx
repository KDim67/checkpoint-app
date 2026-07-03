import React, { useState, useEffect, useMemo, useId } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import mermaid from 'mermaid'

// Initialize Mermaid once for local dark-theme diagram rendering.
try {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    themeVariables: {
      background: '#131622',
      primaryColor: '#1e45fc',
      secondaryColor: '#cdf12b',
      lineColor: '#535e85',
      textColor: '#f1f5f9'
    }
  })
} catch (err) {
  console.error('Failed to initialize mermaid:', err)
}

// Inline Mermaid chart renderer.
function MermaidChart({ code }: { code: string }): React.JSX.Element {
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const reactId = useId()
  const elementId = `mermaid-${reactId.replace(/:/g, '')}`

  useEffect(() => {
    let isMounted = true
    setError(null)

    const renderChart = async (): Promise<void> => {
      try {
        const { svg: renderedSvg } = await mermaid.render(elementId, code)
        if (isMounted) setSvg(renderedSvg)
      } catch (err) {
        console.error('Mermaid render error:', err)
        if (isMounted) {
          const errMsg = err instanceof Error ? err.message : String(err)
          setError(errMsg || 'Failed to render Mermaid chart')
        }
      }
    }

    renderChart()
    return () => {
      isMounted = false
    }
  }, [code, elementId])

  if (error) {
    return (
      <pre style={{
        color: 'var(--color-error)',
        background: 'var(--color-error-muted)',
        padding: 'var(--space-3)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap'
      }}>
        {error}
      </pre>
    )
  }

  if (!svg) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', fontStyle: 'italic', padding: 'var(--space-2)' }}>
        Rendering diagram…
      </div>
    )
  }

  return (
    <div
      dangerouslySetInnerHTML={{ __html: svg }}
      style={{
        display: 'flex',
        justifyContent: 'center',
        background: 'var(--color-surface-2)',
        padding: 'var(--space-4)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-surface-offset)',
        overflowX: 'auto',
        margin: 'var(--space-4) 0'
      }}
    />
  )
}

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
