import React, { useRef, useEffect } from 'react'
import { Send, Square } from 'lucide-react'
import type { Item } from '../../../../shared/types'

interface ChatInputProps {
  value: string
  onChange: (val: string) => void
  onSubmit: () => void
  onAbort: () => void
  isStreaming: boolean
  contextItem: Item | null
}

export default function ChatInput({
  value,
  onChange,
  onSubmit,
  onAbort,
  isStreaming,
  contextItem
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea height as user types
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(180, textarea.scrollHeight)}px`
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (value.trim() && !isStreaming) {
        onSubmit()
      }
    }
  }

  const applyTemplate = (type: 'summarize' | 'debug' | 'breakdown') => {
    let contextStr = '[No context item selected]'
    if (contextItem) {
      contextStr = `Title: ${contextItem.title}\n\nContent:\n${contextItem.body || '[No description]'}`
    }

    let prompt = ''
    switch (type) {
      case 'summarize':
        prompt = `Summarize the following in 3 bullet points:\n\n${contextStr}`
        break
      case 'debug':
        prompt = `I'm stuck on this. What could be wrong?\n\n${contextStr}`
        break
      case 'breakdown':
        prompt = `Break this into 5 concrete sub-tasks:\n\n${contextStr}`
        break
    }

    onChange(prompt)
    textareaRef.current?.focus()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
      {/* Quick Prompt Templates */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <button
          onClick={() => applyTemplate('summarize')}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            fontSize: '10px',
            cursor: 'pointer',
            fontWeight: 'var(--weight-semibold)'
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          Summarize
        </button>
        <button
          onClick={() => applyTemplate('debug')}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            fontSize: '10px',
            cursor: 'pointer',
            fontWeight: 'var(--weight-semibold)'
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          Debug Help
        </button>
        <button
          onClick={() => applyTemplate('breakdown')}
          style={{
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            color: 'var(--color-text-muted)',
            borderRadius: 'var(--radius-sm)',
            padding: '2px 8px',
            fontSize: '10px',
            cursor: 'pointer',
            fontWeight: 'var(--weight-semibold)'
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          Break Down
        </button>
      </div>

      {/* Input Field Container */}
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-2)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          alignItems: 'flex-end',
          boxSizing: 'border-box'
        }}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? 'Streaming completion...' : 'Ask assistant...'}
          disabled={isStreaming}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--color-text-base)',
            fontSize: 'var(--text-xs)',
            lineHeight: 1.5,
            resize: 'none',
            padding: '4px 0',
            maxHeight: '180px',
            fontFamily: 'inherit'
          }}
        />

        {/* Action Button: Send or Stop */}
        {isStreaming ? (
          <button
            onClick={onAbort}
            style={{
              background: 'var(--color-error, #ef4444)',
              border: 'none',
              color: 'var(--color-text-inverted)',
              borderRadius: 'var(--radius-md)',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flexShrink: 0
            }}
            title="Stop generating"
          >
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!value.trim()}
            style={{
              background: value.trim() ? 'var(--color-secondary)' : 'var(--color-surface-offset)',
              border: 'none',
              color: value.trim() ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
              borderRadius: 'var(--radius-md)',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: value.trim() ? 'pointer' : 'default',
              flexShrink: 0
            }}
          >
            <Send size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
