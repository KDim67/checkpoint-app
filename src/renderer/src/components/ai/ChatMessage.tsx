import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CustomCodeBlock } from '../log/LogEntry'
import { Sparkles, User } from 'lucide-react'

interface ChatMessageProps {
  message: {
    role: 'system' | 'user' | 'assistant'
    content: string
  }
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  if (message.role === 'system') return null // Do not render system instructions in bubbles

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-3)',
        flexDirection: isUser ? 'row-reverse' : 'row',
        alignItems: 'flex-start',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {/* Role Avatar */}
      <div
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isUser ? 'var(--color-primary)' : 'var(--color-secondary-muted)',
          color: isUser ? 'var(--color-text-inverted)' : 'var(--color-secondary)',
          border: isUser ? 'none' : '1px solid var(--color-secondary)'
        }}
      >
        {isUser ? <User size={12} /> : <Sparkles size={12} fill="currentColor" />}
      </div>

      {/* Bubble Content */}
      <div
        style={{
          background: isUser ? 'var(--color-surface-offset)' : 'transparent',
          border: isUser ? '1px solid var(--color-surface-offset)' : 'none',
          borderRadius: 'var(--radius-lg)',
          padding: isUser ? 'var(--space-2.5) var(--space-4)' : '0',
          maxWidth: '85%',
          fontSize: 'var(--text-xs)',
          lineHeight: 1.6,
          color: 'var(--color-text-base)',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
        className={isUser ? undefined : 'markdown-body'}
      >
        {isUser ? (
          <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const isBlock = className?.includes('language-') || String(children).includes('\n')
                return isBlock ? (
                  <CustomCodeBlock
                    language={match ? match[1] : undefined}
                    value={String(children).replace(/\n$/, '')}
                  />
                ) : (
                  <code
                    className={className}
                    {...props}
                    style={{
                      background: 'var(--color-surface-2)',
                      padding: '2px 4px',
                      borderRadius: 'var(--radius-sm)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9em',
                      color: 'var(--color-secondary)'
                    }}
                  >
                    {children}
                  </code>
                )
              }
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
