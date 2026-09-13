/** the code override turns fences into CodeBlock; inlineCodeSurface papers over three disagreeing call sites */

import React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from './CodeBlock'

interface MarkdownProps {
  children: string
  inlineCodeSurface?: string
  /** merged over the built-ins */
  components?: Components
}

export default function Markdown({
  children,
  inlineCodeSurface = 'var(--color-surface-1)',
  components
}: MarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={url => url}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const isBlock = className?.includes('language-') || String(children).includes('\n')
          return isBlock ? (
            <CodeBlock
              language={match ? match[1] : undefined}
              value={String(children).replace(/\n$/, '')}
            />
          ) : (
            <code
              className={className}
              {...props}
              style={{
                background: inlineCodeSurface,
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.9em',
                color: 'var(--color-secondary)'
              }}
            >
              {children}
            </code>
          )
        },
        ...components
      }}
    >
      {children}
    </ReactMarkdown>
  )
}
