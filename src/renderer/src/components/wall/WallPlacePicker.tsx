import type { Dispatch, SetStateAction } from 'react'
import { Plus } from 'lucide-react'
import type { WallItem, WallItemKind } from '../../../../shared/wallModel'
import type { NoteMetadata } from '../../../../shared/types'

interface WallPlacePickerProps {
  picker: 'card' | 'doc'
  pickerRows: { ref: string; label: string }[]
  notes: NoteMetadata[]
  addItem: (kind: WallItemKind, extra: Partial<WallItem>) => void
  setPicker: Dispatch<SetStateAction<'card' | 'doc' | null>>
}

export default function WallPlacePicker({
  picker, pickerRows, notes, addItem, setPicker
}: WallPlacePickerProps) {
  return (
    <div data-wall-ui style={{
      position: 'absolute', top: '100%', left: 'var(--space-3)', zIndex: 20,
      marginTop: '4px', width: '300px', maxHeight: '340px', overflowY: 'auto',
      background: 'var(--color-surface-elevated)', border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', padding: '4px'
    }}>
      {pickerRows.length === 0 ? (
        <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
          {picker === 'card'
            ? 'Every card is already on the wall.'
            : notes.length === 0 ? 'No notes yet.' : 'Every note is already on the wall.'}
        </div>
      ) : pickerRows.map(row => (
        <button
          key={row.ref}
          onClick={() => { addItem(picker === 'card' ? 'card' : 'doc', { ref: row.ref }); setPicker(null) }}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
            textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
            padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-base)', fontSize: 'var(--text-xs)'
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-surface-offset)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
        >
          <Plus size={12} style={{ flexShrink: 0, color: 'var(--color-text-faint)' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
        </button>
      ))}
    </div>
  )
}
