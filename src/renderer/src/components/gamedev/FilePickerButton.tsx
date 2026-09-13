/** shared by three panels that carried identical copies */

import React from 'react'
import { Plus } from 'lucide-react'

interface FilePickerButtonProps {
  onClick: () => void
  /** null until chosen */
  path: string | null
  /** shown before anything is chosen */
  placeholder: string
}

/** last segment only, the full path shows underneath */
function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export default function FilePickerButton({ onClick, path, placeholder }: FilePickerButtonProps) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-base)',
        fontSize: 'var(--text-xs)',
        padding: '10px var(--space-3)',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        overflow: 'hidden'
      }}
    >
      <span style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginRight: 'var(--space-2)'
      }}>
        {path ? nameOf(path) : placeholder}
      </span>
      <Plus size={14} className="icon-accent" />
    </button>
  )
}
