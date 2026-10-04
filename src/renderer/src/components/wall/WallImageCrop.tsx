/** the whole picture with a window over it: drag the window, keep what is inside */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, X, Undo2 } from 'lucide-react'
import type { ImageCrop, WallItem } from '../../../../shared/wallModel'
import { cropFrame, cropOf, dragCrop, FULL_CROP, type CropHandle } from '../../../../shared/wallCrop'

interface Props {
  item: WallItem
  /** the kept window and the picture's own pixel size, which decides the new shape of the item */
  onApply: (crop: ImageCrop, natural: { width: number; height: number }) => void
  onCancel: () => void
}

/** corner and edge grips, as fractions along the window they sit on */
const GRIPS: { handle: CropHandle; across: number; down: number; cursor: string }[] = [
  { handle: 'nw', across: 0, down: 0, cursor: 'nwse-resize' },
  { handle: 'n', across: 0.5, down: 0, cursor: 'ns-resize' },
  { handle: 'ne', across: 1, down: 0, cursor: 'nesw-resize' },
  { handle: 'e', across: 1, down: 0.5, cursor: 'ew-resize' },
  { handle: 'se', across: 1, down: 1, cursor: 'nwse-resize' },
  { handle: 's', across: 0.5, down: 1, cursor: 'ns-resize' },
  { handle: 'sw', across: 0, down: 1, cursor: 'nesw-resize' },
  { handle: 'w', across: 0, down: 0.5, cursor: 'ew-resize' }
]

/** the picture letterboxed inside the item's box, so nothing looks stretched while it is cropped */
function containedIn(box: { width: number; height: number }, natural: { width: number; height: number }): CSSProperties {
  const scale = Math.min(box.width / natural.width, box.height / natural.height)
  const width = (natural.width * scale * 100) / box.width
  const height = (natural.height * scale * 100) / box.height
  return {
    position: 'absolute',
    left: `${(100 - width) / 2}%`,
    top: `${(100 - height) / 2}%`,
    width: `${width}%`,
    height: `${height}%`
  }
}

export default function WallImageCrop({ item, onApply, onCancel }: Props): React.JSX.Element {
  const [crop, setCrop] = useState<ImageCrop>(() => cropOf(item))
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  /** the drawn picture, so a drag reads fractions of it whatever the zoom */
  const pictureRef = useRef<HTMLDivElement>(null)

  /** Enter keeps it, the way a dialog does; Esc is the wall's own way out of everything */
  useEffect(() => {
    if (!natural) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return
      e.preventDefault()
      onApply(crop, natural)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [crop, natural, onApply])

  const grab = (handle: CropHandle) => (e: ReactPointerEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    const area = pictureRef.current?.getBoundingClientRect()
    if (!area || area.width === 0 || area.height === 0) return

    const startX = e.clientX
    const startY = e.clientY
    const from = crop
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)

    const move = (ev: PointerEvent): void => {
      setCrop(dragCrop(from, handle, (ev.clientX - startX) / area.width, (ev.clientY - startY) / area.height))
    }
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const kept: CSSProperties = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`
  }

  const action = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    primary = false,
    key?: string
  ): React.JSX.Element => (
    <button
      type="button"
      onClick={onClick}
      onPointerDown={e => e.stopPropagation()}
      title={key ? `${label} (${key})` : label}
      aria-label={label}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '3px 8px', cursor: 'pointer',
        background: primary ? 'var(--color-primary)' : 'transparent',
        border: `1px solid ${primary ? 'var(--color-primary)' : 'var(--color-surface-offset)'}`,
        borderRadius: 'var(--radius-sm)',
        color: primary ? 'var(--color-text-inverted)' : 'var(--color-text-base)',
        fontSize: 'var(--text-xs)', whiteSpace: 'nowrap'
      }}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div
      data-wall-ui
      role="group"
      aria-label="Crop this image"
      onPointerDown={e => e.stopPropagation()}
      style={{ position: 'absolute', inset: 0, zIndex: 6, background: 'rgba(0, 0, 0, 0.55)' }}
    >
      {natural && (
        <div ref={pictureRef} style={containedIn(item, natural)}>
          {/* the whole picture faint, and the kept part over it at full strength */}
          <img
            src={`checkpoint-media://${item.ref}`}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block', opacity: 0.4 }}
          />

          <div style={{ position: 'absolute', ...kept, overflow: 'hidden', outline: '1px solid var(--color-secondary)' }}>
            <img
              src={`checkpoint-media://${item.ref}`}
              alt=""
              draggable={false}
              style={{ position: 'absolute', ...cropFrame(crop), objectFit: 'fill', display: 'block' }}
            />
          </div>

          <div onPointerDown={grab('move')} style={{ position: 'absolute', ...kept, cursor: 'move' }} />

          {GRIPS.map(grip => (
            <div
              key={grip.handle}
              onPointerDown={grab(grip.handle)}
              role="slider"
              aria-label={`Crop edge ${grip.handle}`}
              aria-valuetext={`${Math.round(crop.w * 100)} by ${Math.round(crop.h * 100)} percent of the picture`}
              style={{
                position: 'absolute',
                left: `${(crop.x + crop.w * grip.across) * 100}%`,
                top: `${(crop.y + crop.h * grip.down) * 100}%`,
                width: '12px', height: '12px', marginLeft: '-6px', marginTop: '-6px',
                background: 'var(--color-secondary)',
                border: '2px solid var(--color-surface-1)',
                borderRadius: '2px',
                cursor: grip.cursor
              }}
            />
          ))}
        </div>
      )}

      {/* measured off-screen so the grips can be positioned before anything is drawn */}
      {!natural && (
        <img
          src={`checkpoint-media://${item.ref}`}
          alt=""
          className="is-hidden"
          onLoad={e => setNatural({
            width: (e.currentTarget as HTMLImageElement).naturalWidth,
            height: (e.currentTarget as HTMLImageElement).naturalHeight
          })}
        />
      )}

      <div style={{
        position: 'absolute', top: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
        display: 'flex', alignItems: 'center', gap: '4px',
        padding: '3px', background: 'var(--color-surface-elevated)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)'
      }}>
        {action('Keep this part', <Check size={12} />, () => natural && onApply(crop, natural), true, 'Enter')}
        {action('Whole picture', <Undo2 size={12} />, () => setCrop(FULL_CROP))}
        {action('Cancel', <X size={12} />, onCancel, false, 'Esc')}
      </div>
    </div>
  )
}
