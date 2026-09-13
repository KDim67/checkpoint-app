import type { Dispatch, SetStateAction } from 'react'
import type { Item } from '@shared/types'
import type { ColumnConfig } from '@shared/boardModel'
import useFocusTrap from '../ui/useFocusTrap'
import useEscapeKey from '../ui/useEscapeKey'

interface ArchiveBinProps {
  archivedColumns: ColumnConfig[]
  /** the drawer shows the archived ones */
  cards: Item[]
  /** owned by the board: the drawer unmounts on reload and the selection should survive */
  selectedIds: Set<string>
  setSelected: Dispatch<SetStateAction<Set<string>>>
  onClose: () => void
  onRestoreColumn: (id: string) => void
  onDeleteColumn: (id: string) => void
  onRestoreCard: (id: string) => void
  onDeleteCard: (card: Item) => void
  onBulkRestore: () => void
  onBulkDelete: () => void
}

export default function ArchiveBin({
  archivedColumns,
  cards,
  selectedIds,
  setSelected,
  onClose,
  onRestoreColumn,
  onDeleteColumn,
  onRestoreCard,
  onDeleteCard,
  onBulkRestore,
  onBulkDelete
}: ArchiveBinProps) {
  // mounted only while open, so both are just on
  const archiveBinRef = useFocusTrap(true)
  useEscapeKey(onClose, true)

  const toggle = (id: string): void => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div
      ref={archiveBinRef}
      role="dialog"
      aria-modal="true"
      aria-label="Archive bin"
      onClick={() => onClose()}
      style={{
        position: 'fixed',
        top: '32px',
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 850,
        display: 'flex',
        justifyContent: 'flex-end',
        backdropFilter: 'blur(1px)'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '320px',
          maxWidth: '100vw',
          height: '100%',
          background: 'var(--color-surface-1)',
          borderLeft: '1px solid var(--color-surface-offset)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
          animation: 'slide-in 0.25s cubic-bezier(0.32, 0.72, 0, 1)'
        }}
      >
        <div style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--color-surface-offset)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="text-item-strong">
            Archive Bin
          </span>
          <button
            onClick={() => onClose()}
            style={{ background: 'transparent', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '18px' }}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          
          <div className="col">
            <span className="label-caps-sm">
              Archived Columns ({archivedColumns.length})
            </span>
            {archivedColumns.map(col => (
              <div
                key={col.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: 'var(--color-surface-2)',
                  border: '1px solid var(--color-surface-offset)',
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)'
                }}
              >
                <span className="text-label-xs-medium">
                  {col.name}
                </span>
                <div className="flex-6px">
                  <button
                    onClick={() => onRestoreColumn(col.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', fontSize: '10px', cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}
                  >
                    Restore
                  </button>
                  <button
                    onClick={() => onDeleteColumn(col.id)}
                    style={{ background: 'transparent', border: 'none', color: 'var(--color-error)', fontSize: '10px', cursor: 'pointer' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {archivedColumns.length === 0 && (
              <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No archived columns.</span>
            )}
          </div>

          {(() => {
            const archivedCards = cards.filter(c => c.status === 'archived')
            const allSelected = archivedCards.length > 0 && archivedCards.every(c => selectedIds.has(c.id))
            const selCount = archivedCards.reduce((n, c) => n + (selectedIds.has(c.id) ? 1 : 0), 0)
            return (
              <div className="col">
                <div className="row-between-8px">
                  <span className="label-caps-sm">
                    Archived Cards ({archivedCards.length})
                  </span>
                  {archivedCards.length > 0 && (
                    <button
                      onClick={() => setSelected(allSelected ? new Set() : new Set(archivedCards.map(c => c.id)))}
                      style={{ background: 'transparent', border: 'none', color: 'var(--color-primary)', fontSize: '10px', cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}
                    >
                      {allSelected ? 'Clear' : 'Select all'}
                    </button>
                  )}
                </div>

                {/* shows when something's selected */}
                {selCount > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', background: 'var(--color-primary-muted)', border: '1px solid var(--color-primary)', borderRadius: 'var(--radius-md)', padding: '6px 10px' }}>
                    <span className="text-label-xs-semibold">
                      {selCount} selected
                    </span>
                    <div className="flex-6px">
                      <button
                        onClick={onBulkRestore}
                        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-surface-offset)', color: 'var(--color-secondary)', fontSize: '10px', fontWeight: 'var(--weight-semibold)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 10px' }}
                      >
                        Restore
                      </button>
                      <button
                        onClick={onBulkDelete}
                        style={{ background: 'var(--color-error)', border: 'none', color: 'var(--color-on-accent)', fontSize: '10px', fontWeight: 'var(--weight-bold)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: '3px 10px' }}
                      >
                        Delete ({selCount})
                      </button>
                    </div>
                  </div>
                )}

                {archivedCards.map(card => {
                  const selected = selectedIds.has(card.id)
                  return (
                    <div
                      key={card.id}
                      onClick={() => toggle(card.id)}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                        background: selected ? 'var(--color-primary-muted)' : 'var(--color-surface-2)',
                        border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-surface-offset)'}`,
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        <span
                          aria-hidden
                          style={{
                            width: '15px', height: '15px', flexShrink: 0, borderRadius: '4px',
                            border: `1.5px solid ${selected ? 'var(--color-primary)' : 'var(--color-balance)'}`,
                            background: selected ? 'var(--color-primary)' : 'transparent',
                            color: 'var(--color-on-accent)', fontSize: '10px', lineHeight: '13px', textAlign: 'center', fontWeight: 'bold'
                          }}
                        >
                          {selected ? '✓' : ''}
                        </span>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', fontWeight: 'var(--weight-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={card.title}>
                          {card.title}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                          onClick={e => { e.stopPropagation(); onRestoreCard(card.id) }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-secondary)', fontSize: '10px', cursor: 'pointer', fontWeight: 'var(--weight-semibold)' }}
                        >
                          Restore
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); onDeleteCard(card) }}
                          style={{ background: 'transparent', border: 'none', color: 'var(--color-error)', fontSize: '10px', cursor: 'pointer' }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )
                })}
                {archivedCards.length === 0 && (
                  <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--color-text-faint)', fontStyle: 'italic' }}>No archived cards.</span>
                )}
              </div>
            )
          })()}

        </div>
      </div>
    </div>
  )
}
