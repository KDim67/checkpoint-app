import React, { useState, useRef, useEffect } from 'react'
import { Send, Hash } from 'lucide-react'

interface LogInputProps {
  context: string
  onSubmit: (body: string, tagIds: string[]) => Promise<void>
}

const CURATED_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#3b82f6', // Blue
  '#10b981', // Green
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#38bdf8', // Sky
  '#fbbf24', // Amber
  '#a3e635', // Lime
  '#22d3ee'  // Cyan
]

export default function LogInput({ context, onSubmit }: LogInputProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea height
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 240)}px`
  }, [value])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text')
    // If user pastes block starting with ``` and it doesn't end with ```, auto wrap/close it
    if (text.trim().startsWith('```') && !text.trim().endsWith('```')) {
      e.preventDefault()
      const wrappedText = `${text}\n\`\`\``
      const start = e.currentTarget.selectionStart
      const end = e.currentTarget.selectionEnd
      const newValue = value.substring(0, start) + wrappedText + value.substring(end)
      setValue(newValue)
    }
  }

  const handleSubmit = async () => {
    const text = value.trim()
    if (!text || submitting) return

    setSubmitting(true)
    try {
      // 1. Detect tags (#tagname)
      const tagRegex = /#([a-zA-Z0-9-_]+)/g
      const matches: string[] = []
      let match
      while ((match = tagRegex.exec(text)) !== null) {
        const tagName = match[1].toLowerCase()
        if (!matches.includes(tagName)) {
          matches.push(tagName)
        }
      }

      // 2. Fetch all existing tags to see if we need to create any
      const existingTags = await window.electronAPI.db.getTags()
      const tagIds: string[] = []

      for (const tagName of matches) {
        const existing = existingTags.find(t => t.name.toLowerCase() === tagName)
        if (existing) {
          tagIds.push(existing.id)
        } else {
          // Create new tag with a random curated color
          const randomColor = CURATED_COLORS[Math.floor(Math.random() * CURATED_COLORS.length)]
          const newTag = await window.electronAPI.db.createTag({
            name: tagName,
            color: randomColor
          })
          tagIds.push(newTag.id)
        }
      }

      // 3. Submit
      await onSubmit(text, tagIds)
      setValue('')
      
      // Focus back
      textareaRef.current?.focus()
    } catch (err) {
      console.error('Failed to save log entry:', err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      padding: 'var(--space-4) var(--space-6)',
      background: 'var(--color-surface-1)',
      borderTop: '1px solid var(--color-surface-offset)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 'var(--space-2)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-2) var(--space-3)',
        transition: 'border-color var(--duration-fast) var(--ease-default)'
      }}
      onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
      onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--color-surface-offset)')}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={`Type a log for context "${context}"... (Use #tags, Markdown, or Shift+Enter for newlines)`}
          rows={1}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--color-text-base)',
            fontFamily: 'inherit',
            fontSize: 'var(--text-sm)',
            resize: 'none',
            maxHeight: '240px',
            padding: '4px 0',
            lineHeight: 1.5
          }}
        />
        
        <button
          onClick={handleSubmit}
          disabled={!value.trim() || submitting}
          title="Send Log Entry (Enter)"
          style={{
            background: value.trim() && !submitting ? 'var(--color-secondary)' : 'transparent',
            border: 'none',
            color: value.trim() && !submitting ? 'var(--color-text-inverted)' : 'var(--color-text-faint)',
            borderRadius: 'var(--radius-md)',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: value.trim() && !submitting ? 'pointer' : 'default',
            flexShrink: 0,
            transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)'
          }}
          onMouseEnter={e => {
            if (value.trim() && !submitting) {
              e.currentTarget.style.filter = 'brightness(1.1)'
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.filter = 'none'
          }}
        >
          <Send size={16} />
        </button>
      </div>
      
      {/* Help info / active tags indicator */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: 'var(--text-2xs)',
        color: 'var(--color-text-faint)',
        padding: '0 var(--space-1)'
      }}>
        <span>Markdown is supported. Auto-detects pasted <code>```code```</code> blocks.</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          <Hash size={10} /> Type hashtags to categorize logs
        </span>
      </div>
    </div>
  )
}
