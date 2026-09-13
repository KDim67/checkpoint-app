import React, { useState, useRef, useEffect } from 'react'
import { Send, Hash } from 'lucide-react'
import { handleImagePaste, handleImageDrop } from '../../lib/mediaHelper'
import { resolveTagIds } from '../../data/tags'

interface LogInputProps {
  context: string
  onSubmit: (body: string, tagIds: string[]) => Promise<void>
}

const CURATED_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#3b82f6', // blue
  '#10b981', // green
  '#a855f7', // purple
  '#ec4899', // pink
  '#38bdf8', // sky
  '#fbbf24', // amber
  '#a3e635', // lime
  '#22d3ee'  // cyan
]

export default function LogInput({ context, onSubmit }: LogInputProps) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const isImage = await handleImagePaste(e, value, setValue)
    if (isImage) return

    const text = e.clipboardData.getData('text')
    // close an unterminated ``` paste
    if (text.trim().startsWith('```') && !text.trim().endsWith('```')) {
      e.preventDefault()
      const wrappedText = `${text}\n\`\`\``
      const start = e.currentTarget.selectionStart
      const end = e.currentTarget.selectionEnd
      const newValue = value.substring(0, start) + wrappedText + value.substring(end)
      setValue(newValue)
    }
  }

  const handleDrop = async (e: React.DragEvent<HTMLTextAreaElement>) => {
    await handleImageDrop(e, value, setValue)
  }

  const handleSubmit = async () => {
    const text = value.trim()
    if (!text || submitting) return

    setSubmitting(true)
    try {
      const tagRegex = /#([a-zA-Z0-9-_]+)/g
      const matches: string[] = []
      let match
      while ((match = tagRegex.exec(text)) !== null) {
        const tagName = match[1].toLowerCase()
        if (!matches.includes(tagName)) {
          matches.push(tagName)
        }
      }

      // create tags that don't exist yet
      const tagIds = await resolveTagIds(
        matches.map(name => ({
          name,
          color: CURATED_COLORS[Math.floor(Math.random() * CURATED_COLORS.length)]
        }))
      )

      await onSubmit(text, tagIds)
      setValue('')
      
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
      gap: 'var(--space-2)',
      flexShrink: 0
    }}>
      <div className="log-input-box border-offset" style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 'var(--space-2)',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-2) var(--space-3)',
        transition: 'border-color var(--duration-fast) var(--ease-default)'
      }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          placeholder={`Type a log for "${context}"... (Use #tags, Markdown, or Shift+Enter for newlines)`}
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
          className="log-input-send"
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
        >
          <Send size={16} />
        </button>
      </div>
      
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
