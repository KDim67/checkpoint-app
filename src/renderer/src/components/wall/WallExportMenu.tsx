import type { Dispatch, SetStateAction } from 'react'
import { Download, Upload } from 'lucide-react'
import { toolButton } from './wallButtons'

export type ExportChoice = 'png' | 'selection' | 'svg' | 'pdf' | 'csv' | 'json' | 'json-selection'

interface WallExportMenuProps {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  hasItems: boolean
  hasSelection: boolean
  /** a PDF page each, or the whole wall on one page when there are none */
  frameCount: number
  onExport: (choice: ExportChoice) => void
  onImportWall?: () => void
}

export default function WallExportMenu({ open, setOpen, hasItems, hasSelection, frameCount, onExport, onImportWall }: WallExportMenuProps) {
  const options: { choice: ExportChoice; label: string; detail: string; disabled?: boolean }[] = [
    { choice: 'png', label: 'Whole wall as PNG', detail: 'A picture of everything on it' },
    { choice: 'selection', label: 'Selection as PNG', detail: hasSelection ? 'Just what is selected' : 'Select something first', disabled: !hasSelection },
    { choice: 'svg', label: 'Whole wall as SVG', detail: 'Stays sharp at any size' },
    frameCount > 0
      ? { choice: 'pdf', label: 'Frames as PDF, a page each', detail: `${frameCount} page${frameCount === 1 ? '' : 's'}, in reading order` }
      : { choice: 'pdf', label: 'Whole wall as PDF', detail: 'One page. Add frames for one page each' },
    { choice: 'csv', label: 'Words as CSV', detail: "Every item's words, for a spreadsheet" },
    { choice: 'json', label: 'Whole wall as JSON', detail: 'Wall items, camera and background as JSON' },
    { choice: 'json-selection', label: 'Selection as JSON', detail: hasSelection ? 'Just what is selected as JSON' : 'Select something first', disabled: !hasSelection }
  ]

  const canOpen = hasItems || !!onImportWall

  return (
    <div data-wall-popover="export" className="relative">
      {toolButton('Export', <Download size={14} />, () => setOpen(v => !v), { active: open, disabled: !canOpen })}

      {open && canOpen && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41, width: '250px', padding: '4px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}
        >
          {options.map(option => (
            <button
              key={option.label}
              onClick={() => { setOpen(false); onExport(option.choice) }}
              disabled={option.disabled || (!hasItems && option.choice !== 'json')}
              className="bg-clear hover-bg-offset"
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', width: '100%',
                textAlign: 'left', border: 'none', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                cursor: (option.disabled || (!hasItems && option.choice !== 'json')) ? 'default' : 'pointer',
                opacity: (option.disabled || (!hasItems && option.choice !== 'json')) ? 'var(--opacity-disabled)' : 1
              }}
            >
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>{option.label}</span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>{option.detail}</span>
            </button>
          ))}

          {onImportWall && (
            <>
              <div style={{ margin: '4px 0', borderTop: '1px solid var(--color-surface-offset)' }} />
              <button
                onClick={() => { setOpen(false); onImportWall() }}
                className="bg-clear hover-bg-offset"
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', width: '100%',
                  textAlign: 'left', border: 'none', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer'
                }}
              >
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Upload size={12} /> Import wall (JSON)
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>Open a wall JSON file into a new wall</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
