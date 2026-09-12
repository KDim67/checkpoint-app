import React, { useState } from 'react'
import Markdown from '../ui/Markdown'
import { formatDistanceToNow } from 'date-fns'
import { Copy, Pin, Trash2, ArrowRightLeft, Check } from 'lucide-react'
import type { Item } from '../../../../shared/types'
import { COPIED_FEEDBACK_MS } from '../../lib/timings'
import FormActions from '../ui/FormActions'

interface LogEntryProps {
  item: Item
  onTogglePin: (id: string, currentPriority: number) => void
  onDelete: (id: string) => void
  onConvertToCard: (id: string, title: string, tagIds: string[]) => void
}

export default function LogEntry({ item, onTogglePin, onDelete, onConvertToCard }: LogEntryProps) {
  const [hovered, setHovered] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [cardTitle, setCardTitle] = useState(() => {
    const firstLine = item.body.split('\n')[0].replace(/^[#\s*>-]+/, '').trim()
    return firstLine.substring(0, 80) || 'Untitled Log Entry'
  })

  const relativeTime = formatDistanceToNow(new Date(item.created_at), { addSuffix: true })
  const absoluteTime = new Date(item.created_at).toLocaleString()

  const handleCopyRaw = async () => {
    await navigator.clipboard.writeText(item.body)
    setCopied(true)
    setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS)
  }

  const handleConvertSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!cardTitle.trim()) return
    const tagIds = item.tags?.map(t => t.id) || []
    onConvertToCard(item.id, cardTitle.trim(), tagIds)
    setShowConvertModal(false)
  }

  const isPinned = item.priority === 3

  return (
    <div
      className="log-entry-container"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-4) var(--space-6)',
        borderBottom: '1px solid var(--color-surface-offset)',
        background: isPinned ? 'var(--color-secondary-muted)' : 'transparent',
        position: 'relative',
        transition: 'background var(--duration-fast) var(--ease-default)'
      }}
    >
      {/* Header Info */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
        <div className="row">
          {isPinned && (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-secondary)',
              background: 'var(--color-surface-offset)',
              padding: '2px 6px',
              borderRadius: 'var(--radius-sm)'
            }}>
              <Pin size={10} fill="currentColor" /> PINNED
            </span>
          )}
          <span
            title={absoluteTime}
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              cursor: 'help'
            }}
          >
            {relativeTime}
          </span>
        </div>

        {/* Action Row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          opacity: hovered ? 1 : 0,
          pointerEvents: hovered ? 'auto' : 'none',
          transition: 'opacity var(--duration-fast) var(--ease-default)'
        }}>
          <button
            onClick={handleCopyRaw}
            title="Copy Raw Markdown"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: 'var(--text-xs)'
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          >
            {copied ? <Check size={12} style={{ color: 'var(--color-success)' }} /> : <Copy size={12} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
          
          <button
            onClick={() => onTogglePin(item.id, item.priority)}
            title={isPinned ? 'Unpin' : 'Pin to Top'}
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: isPinned ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: 'var(--text-xs)'
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
            onMouseLeave={e => (e.currentTarget.style.color = isPinned ? 'var(--color-secondary)' : 'var(--color-text-muted)')}
          >
            <Pin size={12} fill={isPinned ? 'currentColor' : 'none'} />
            <span>{isPinned ? 'Unpin' : 'Pin'}</span>
          </button>

          <button
            onClick={() => setShowConvertModal(true)}
            title="Convert to Kanban Card"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-muted)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: 'var(--text-xs)'
            }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-base)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
          >
            <ArrowRightLeft size={12} />
            <span>Convert</span>
          </button>

          <button
            onClick={() => onDelete(item.id)}
            title="Delete Entry"
            style={{
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-error)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: 'var(--text-xs)'
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-error-muted)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-surface-2)')}
          >
            <Trash2 size={12} />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Render Markdown Content */}
      <div style={{
        color: 'var(--color-text-base)',
        fontSize: 'var(--text-sm)',
        lineHeight: 1.6,
        wordBreak: 'break-word'
      }} className="markdown-body">
        <Markdown
          inlineCodeSurface="var(--color-surface-2)"
          components={{
            p({ children }) {
              return <p style={{ margin: '0 0 var(--space-2) 0' }}>{children}</p>
            },
            ul({ children }) {
              return <ul style={{ margin: '0 0 var(--space-3) 0', paddingLeft: 'var(--space-5)' }}>{children}</ul>
            },
            ol({ children }) {
              return <ol style={{ margin: '0 0 var(--space-3) 0', paddingLeft: 'var(--space-5)' }}>{children}</ol>
            },
            li({ children }) {
              return <li style={{ marginBottom: 'var(--space-1)' }}>{children}</li>
            },
            h1({ children }) { return <h1 style={{ fontSize: '1.4em', fontWeight: 'var(--weight-bold)', margin: 'var(--space-4) 0 var(--space-2)' }}>{children}</h1> },
            h2({ children }) { return <h2 style={{ fontSize: '1.25em', fontWeight: 'var(--weight-bold)', margin: 'var(--space-4) 0 var(--space-2)' }}>{children}</h2> },
            h3({ children }) { return <h3 style={{ fontSize: '1.1em', fontWeight: 'var(--weight-semibold)', margin: 'var(--space-3) 0 var(--space-1)' }}>{children}</h3> },
            blockquote({ children }) {
              return (
                <blockquote style={{
                  borderLeft: '3px solid var(--color-secondary)',
                  paddingLeft: 'var(--space-4)',
                  color: 'var(--color-text-muted)',
                  fontStyle: 'italic',
                  margin: 'var(--space-3) 0'
                }}>
                  {children}
                </blockquote>
              )
            }
          }}
        >
          {item.body}
        </Markdown>
      </div>

      {/* Render Tags Row */}
      {item.tags && item.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1-5)', marginTop: 'var(--space-2)' }}>
          {item.tags.map(tag => (
            <span
              key={tag.id}
              style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--weight-semibold)',
                color: tag.color,
                background: `${tag.color}15`,
                border: `1px solid ${tag.color}30`,
                padding: '2px 8px',
                borderRadius: '100px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: tag.color }} />
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Convert to Card Modal */}
      {showConvertModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backdropFilter: 'blur(4px)'
        }}>
          <form
            onSubmit={handleConvertSubmit}
            style={{
              width: '450px',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-6)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-4)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
            }}
          >
            <div className="row">
              <ArrowRightLeft style={{ color: 'var(--color-secondary)' }} size={20} />
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
                Promote to Kanban Card
              </h2>
            </div>
            
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
              Convert this scratchpad log into a fully trackable Kanban card. It will be moved to the Kanban view.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
              <label htmlFor="card-title-input" style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-muted)' }}>
                Card Title
              </label>
              <input
                id="card-title-input"
                type="text"
                value={cardTitle}
                onChange={e => setCardTitle(e.target.value)}
                placeholder="Enter card title..."
                autoFocus
                required
                style={{
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  color: 'var(--color-text-base)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-2.5) var(--space-3.5)',
                  fontSize: 'var(--text-sm)',
                  outline: 'none',
                  transition: 'border-color var(--duration-fast) var(--ease-default)'
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--color-primary)')}
                onBlur={e => (e.target.style.borderColor = 'var(--color-surface-offset)')}
              />
            </div>

            <FormActions onCancel={() => setShowConvertModal(false)} submitLabel="Promote to Card" />
          </form>
        </div>
      )}
    </div>
  )
}
