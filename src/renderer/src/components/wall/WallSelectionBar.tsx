import type { Dispatch, Ref, SetStateAction } from 'react'
import { Type, Trash2, ArrowUp, ArrowDown, Copy, Lock, Unlock } from 'lucide-react'
import { bringToFront, patchItems, sendToBack, WALL_COLORS, ARROW_SHAPES, ARROW_LINES, ARROW_HEAD_MODES, type WallItem } from '../../../../shared/wallModel'
import WallColorPicker from './WallColorPicker'
import { toolButton, arrowStyleButtons } from './wallButtons'

interface WallSelectionBarProps {
  floatingPos: { left: number; top: number }
  floatingRef: Ref<HTMLDivElement>
  swatchOpen: boolean
  setSwatchOpen: Dispatch<SetStateAction<boolean>>
  single: WallItem | null
  arrowsSelected: boolean
  items: WallItem[]
  selectedIds: Set<string>
  setItems: (items: WallItem[]) => void
  setEditingId: Dispatch<SetStateAction<string | null>>
  duplicateSelected: () => void
  toggleLock: () => void
  removeSelected: () => void
}

export default function WallSelectionBar({
  floatingPos, floatingRef, swatchOpen, setSwatchOpen, single, arrowsSelected, items, selectedIds,
  setItems, setEditingId, duplicateSelected, toggleLock, removeSelected
}: WallSelectionBarProps) {
  return (
    <div ref={floatingRef} data-wall-ui style={{
      position: 'absolute',
      left: `${floatingPos.left}px`, top: `${floatingPos.top}px`,
      transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: '2px',
      padding: '3px',
      background: 'var(--color-surface-elevated)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-lg)',
      zIndex: 15
    }}>
      {/* One swatch, not the whole palette laid out flat.

          Nine circles and five buttons in a row made this toolbar wider
          than most of what it floats over, so it covered the thing you
          had just selected. The palette itself has not shrunk back to
          the six colours it used to offer: it is all still here, one
          click in, which is what the pen palette already does. */}
      <div data-wall-swatch className="relative">
        <button
          onClick={() => setSwatchOpen(v => !v)}
          title="Colour"
          aria-label="Colour"
          aria-expanded={swatchOpen}
          className="btn-icon"
          style={{
            width: '30px', height: '30px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: swatchOpen ? 'var(--color-surface-offset)' : undefined
          }}
        >
          <span
            aria-hidden
            style={{
              width: '16px', height: '16px', borderRadius: '50%',
              background: single?.color ?? 'transparent',
              // Nothing selected has a colour of its own yet, or the
              // selection is mixed: an empty ring says so without
              // claiming one of the eight.
              border: single?.color
                ? '1px solid rgba(0, 0, 0, 0.25)'
                : '1px dashed var(--color-text-faint)'
            }}
          />
        </button>

        {swatchOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 42,
            padding: 'var(--space-2)', width: '146px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}>
            <WallColorPicker
              colors={WALL_COLORS}
              value={single?.color}
              onChange={c => {
                setItems(patchItems(items, selectedIds, { color: c }))
                setSwatchOpen(false)
              }}
              columns={4}
            />
          </div>
        )}
      </div>
      <div style={{ width: '1px', height: '16px', background: 'var(--color-surface-offset)', margin: '0 2px' }} />
      {arrowsSelected && arrowStyleButtons(
        single?.arrowShape ?? ARROW_SHAPES[0],
        single?.arrowLine ?? ARROW_LINES[0],
        single?.arrowHeads ?? ARROW_HEAD_MODES[0],
        v => setItems(patchItems(items, selectedIds, { arrowShape: v })),
        v => setItems(patchItems(items, selectedIds, { arrowLine: v })),
        v => setItems(patchItems(items, selectedIds, { arrowHeads: v }))
      )}
      {arrowsSelected && single && toolButton(
        single.text ? 'Edit label' : 'Add a label',
        <Type size={13} />,
        () => setEditingId(single.id)
      )}
      {arrowsSelected && (
        <div style={{ width: '1px', height: '16px', background: 'var(--color-surface-offset)', margin: '0 2px' }} />
      )}
      {toolButton('Bring to front', <ArrowUp size={13} />, () => single && setItems(bringToFront(items, single.id)), { disabled: !single })}
      {toolButton('Send to back', <ArrowDown size={13} />, () => single && setItems(sendToBack(items, single.id)), { disabled: !single })}
      {toolButton('Duplicate', <Copy size={13} />, duplicateSelected)}
      {toolButton(single?.locked ? 'Unlock' : 'Lock', single?.locked ? <Unlock size={13} /> : <Lock size={13} />, toggleLock)}
      {toolButton('Delete', <Trash2 size={13} />, removeSelected)}
    </div>
  )
}
