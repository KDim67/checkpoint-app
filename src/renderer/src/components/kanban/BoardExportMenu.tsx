import { useState, useRef } from 'react'
import { Download, Upload, ArrowUpDown } from 'lucide-react'
import HeaderBtn from './HeaderBtn'
import type { KanbanBoard } from './useKanbanBoard'

interface BoardExportMenuProps {
  kanbanBoard: KanbanBoard
}

export default function BoardExportMenu({ kanbanBoard }: BoardExportMenuProps) {
  const [open, setOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { handleExportBoard, handleImportBoard } = kanbanBoard

  return (
    <div className="relative">
      <HeaderBtn
        active={open}
        onClick={() => setOpen(v => !v)}
        title="Export or import Kanban board"
        icon={<ArrowUpDown size={13} />}
      >
        Export
      </HeaderBtn>

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: 'var(--space-2)',
            minWidth: '220px',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px'
          }}
        >
          <button
            onClick={() => {
              setOpen(false)
              void handleExportBoard()
            }}
            className="bg-clear hover-bg-offset"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '2px',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer'
            }}
          >
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Download size={13} /> Export Board as JSON
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>Save columns, cards, checklist & tags</span>
          </button>

          <div style={{ borderTop: '1px solid var(--color-surface-offset)', margin: '2px 0' }} />

          <button
            onClick={() => {
              setOpen(false)
              fileInputRef.current?.click()
            }}
            className="bg-clear hover-bg-offset"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: '2px',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer'
            }}
          >
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Upload size={13} /> Import Board (JSON)
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>Load cards & columns into workspace</span>
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        className="is-hidden"
        aria-label="Import Kanban JSON file"
        onChange={async e => {
          const file = e.target.files?.[0]
          if (file) {
            const text = await file.text()
            void handleImportBoard(text)
          }
          e.target.value = ''
        }}
      />
    </div>
  )
}
