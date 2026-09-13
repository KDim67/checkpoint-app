import { useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react'
import { Frame, GripVertical, Presentation } from 'lucide-react'
import { frameLabel, moveFrame } from '../../../../shared/wallFrames'
import type { WallItem } from '../../../../shared/wallModel'
import { toolButton } from './wallButtons'

interface WallFramesMenuProps {
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  /** in the order they present in */
  frames: WallItem[]
  onShow: (frame: WallItem) => void
  onPresent: (index: number) => void
  /** every frame's id in its new place */
  onReorder: (ids: string[]) => void
  /** an order was chosen, so there's a reading order to go back to */
  customOrder: boolean
  onResetOrder: () => void
}

const row: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%', textAlign: 'left',
  border: 'none', cursor: 'pointer', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-base)', fontSize: 'var(--text-xs)'
}

/** the wall's frames as its pages: jump to one, put them in order, or present them */
export default function WallFramesMenu({ open, setOpen, frames, onShow, onPresent, onReorder, customOrder, onResetOrder }: WallFramesMenuProps) {
  const [dragging, setDragging] = useState<number | null>(null)
  const none = frames.length === 0

  return (
    <div data-wall-popover="frames" className="relative">
      {toolButton('Frames', <Frame size={14} />, () => setOpen(v => !v), { active: open })}

      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 41,
            width: '250px', maxHeight: '340px', overflowY: 'auto', padding: '4px',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
          }}
        >
          <button
            onClick={() => { setOpen(false); onPresent(0) }}
            disabled={none}
            className="bg-clear hover-bg-offset"
            style={{ ...row, fontWeight: 600, opacity: none ? 0.5 : 1, cursor: none ? 'default' : 'pointer' }}
          >
            <Presentation size={12} /> Present
          </button>

          <div className="rule" />

          {none ? (
            <p style={{ margin: 0, padding: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', lineHeight: 1.5 }}>
              No frames yet. Select some items and choose Frame this selection from the right-click menu.
            </p>
          ) : frames.map((frame, i) => (
            <div
              key={frame.id}
              draggable
              onDragStart={e => {
                setDragging(i)
                e.dataTransfer?.setData('text/plain', frame.id)
              }}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                if (dragging !== null && dragging !== i) onReorder(moveFrame(frames, dragging, i))
                setDragging(null)
              }}
              onDragEnd={() => setDragging(null)}
              // the keyboard's way to move one, from the row's button
              onKeyDown={e => {
                if (!e.altKey) return
                const to = e.key === 'ArrowUp' ? i - 1 : e.key === 'ArrowDown' ? i + 1 : -1
                if (to < 0 || to >= frames.length) return
                e.preventDefault()
                onReorder(moveFrame(frames, i, to))
              }}
              style={{ display: 'flex', alignItems: 'center', opacity: dragging === i ? 0.4 : 1 }}
            >
              <span
                aria-hidden
                title="Drag to change the order they present in"
                style={{ display: 'flex', color: 'var(--color-text-faint)', cursor: 'grab', padding: '0 2px' }}
              >
                <GripVertical size={12} />
              </span>
              <button
                onClick={() => { setOpen(false); onShow(frame) }}
                title="Go to this frame. Alt+Up or Alt+Down moves it."
                className="bg-clear hover-bg-offset"
                style={row}
              >
                <span style={{ color: 'var(--color-text-faint)', fontVariantNumeric: 'tabular-nums', minWidth: '16px' }}>{i + 1}</span>
                <span className="truncate">{frameLabel(frame, i)}</span>
              </button>
            </div>
          ))}

          {customOrder && !none && (
            <>
              <div className="rule" />
              <button onClick={onResetOrder} className="bg-clear hover-bg-offset" style={{ ...row, color: 'var(--color-text-muted)' }}>
                Back to reading order
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
