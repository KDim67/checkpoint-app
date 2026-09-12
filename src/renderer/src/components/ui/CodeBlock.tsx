/**
 * A fenced code block with its language and a copy button.
 *
 * Lived inside LogEntry, which three other screens then imported it from. It is
 * a UI primitive, so it sits with the rest of them.
 */

import React, { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'

export default function CodeBlock({ language, value }: { language?: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  return (
    <div style={{
      margin: 'var(--space-3) 0',
      background: 'var(--color-surface-2)',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--color-surface-offset)',
      overflow: 'hidden'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-2) var(--space-4)',
        background: 'var(--color-surface-offset)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-muted)'
      }}>
        <span>{language || 'code'}</span>
        <button
          onClick={handleCopy}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-muted)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1)',
            padding: 0
          }}
          onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
          onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
        >
          {copied ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
          <span>{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      <pre style={{
        margin: 0,
        padding: 'var(--space-4)',
        overflowX: 'auto',
        fontSize: 'var(--text-sm)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-base)',
        lineHeight: 1.5,
        background: 'transparent'
      }}>
        <code>{value}</code>
      </pre>
    </div>
  )
}
