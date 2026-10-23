import type { ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'

export default function PathRow({ children, openTitle, onOpen }: { children: ReactNode; openTitle: string; onOpen: () => void }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-2)',
      background: 'var(--color-surface-2)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)',
      padding: 'var(--space-2) var(--space-3)'
    }}>
      <code title={typeof children === 'string' ? children : undefined} style={{
        flex: 1,
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {children}
      </code>
      <button
        type="button"
        className="btn-icon"
        title={openTitle}
        aria-label={openTitle}
        style={{ flexShrink: 0 }}
        onClick={onOpen}
      >
        <FolderOpen size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
