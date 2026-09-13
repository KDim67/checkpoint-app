import type { Dispatch, SetStateAction } from 'react'
import { ArchiveRestore } from 'lucide-react'
import type { WallBinEntry, WallItem, WallItemKind } from '../../../../shared/wallModel'
import { plainWallText } from '../../../../shared/wallText'
import { shorten } from '../../../../shared/mcpActivity'
import { formatRelativeTime } from '../notes/notesUtils'
import { toolButton } from './wallButtons'

interface WallBinMenuProps {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  /** newest first, only what's still missing from the wall */
  entries: WallBinEntry[]
  labelOf: (item: WallItem) => string | undefined
  onRestore: (entryId: string) => void
}

const KIND_NAMES: Record<WallItemKind, string> = {
  note: 'A sticky', text: 'Some text', shape: 'A shape', frame: 'A frame', image: 'An image',
  ink: 'A drawing', arrow: 'An arrow', card: 'A card', doc: 'A note', bookmark: 'A link'
}

/** the first thing in it by its words, or by what it was; arrows only count when they're all that went */
function entryName(entry: WallBinEntry, labelOf: (item: WallItem) => string | undefined): string {
  const shown = entry.items.some(i => i.kind !== 'arrow') ? entry.items.filter(i => i.kind !== 'arrow') : entry.items
  const first = shown[0]
  const words = shorten(plainWallText(labelOf(first) ?? '').split('\n')[0] ?? '', 40)
  const name = words || KIND_NAMES[first.kind]
  return shown.length > 1 ? `${name} and ${shown.length - 1} more` : name
}

/** deletions from the last month, each back in one click after undo has moved on */
export default function WallBinMenu({ open, setOpen, entries, labelOf, onRestore }: WallBinMenuProps) {
  return (
    <div data-wall-popover="bin" className="relative">
      {toolButton('Recently deleted', <ArchiveRestore size={14} />, () => setOpen(v => !v), { active: open })}

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41,
            width: '280px', maxHeight: '340px', overflowY: 'auto', padding: '4px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}
        >
          <div style={{ padding: 'var(--space-2)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Recently deleted
          </div>

          {entries.length === 0 ? (
            <p style={{ margin: 0, padding: '0 var(--space-2) var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
              Nothing deleted from this wall in the last 30 days.
            </p>
          ) : entries.map(entry => {
            const name = entryName(entry, labelOf)
            return (
              <div
                key={entry.id}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-1) var(--space-2)' }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>{name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>{formatRelativeTime(entry.at)}</div>
                </div>
                <button
                  onClick={() => onRestore(entry.id)}
                  aria-label={`Restore ${name}`}
                  className="bg-clear hover-bg-offset"
                  style={{
                    flexShrink: 0, border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-sm)',
                    padding: '2px var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', cursor: 'pointer'
                  }}
                >
                  Restore
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
