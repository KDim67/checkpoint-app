import React from 'react'
import { X, FileText, ClipboardList } from 'lucide-react'
import type { Item } from '../../../../shared/types'

interface ContextPillProps {
  item: Item
  onClear: () => void
}

export default function ContextPill({ item, onClear }: ContextPillProps) {
  const getBadgeStyles = () => {
    switch (item.type) {
      case 'card':
        return {
          bg: 'var(--color-primary-muted)',
          border: '1px solid rgba(30, 69, 252, 0.3)',
          color: 'var(--color-primary)',
          label: 'Card',
          icon: <ClipboardList size={10} />
        }
      case 'task':
        return {
          bg: 'var(--color-secondary-muted)',
          border: '1px solid var(--color-secondary)',
          color: 'var(--color-secondary)',
          label: 'Task',
          icon: <FileText size={10} />
        }
      case 'log':
      default:
        return {
          bg: 'var(--color-success-muted)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          color: 'var(--color-success)',
          label: 'Log',
          icon: <FileText size={10} />
        }
    }
  }

  const styles = getBadgeStyles()

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-2) var(--space-3)',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '9px',
          fontWeight: 'var(--weight-bold)',
          background: styles.bg,
          border: styles.border,
          color: styles.color,
          padding: '1px 5px',
          borderRadius: '4px',
          textTransform: 'uppercase',
          flexShrink: 0
        }}
      >
        {styles.icon}
        <span>{styles.label}</span>
      </span>

      <span
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-semibold)',
          color: 'var(--color-text-base)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1
        }}
      >
        {item.title || 'Untitled'}
      </span>

      <button
        onClick={onClear}
        className="text-muted hover-text-base"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
          flexShrink: 0
        }}
        title="Remove context item"
      >
        <X size={13} />
      </button>
    </div>
  )
}
