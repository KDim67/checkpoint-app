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
      <code style={{
        flex: 1,
        fontSize: '11px',
        fontFamily: 'var(--font-mono)',
        color: 'var(--color-text-muted)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }}>
        {children}
      </code>
      <button
        className="btn-icon"
        title={openTitle}
        style={{ width: '28px', height: '28px', flexShrink: 0 }}
        onClick={onOpen}
      >
        <FolderOpen size={13} />
      </button>
    </div>
  )
}
