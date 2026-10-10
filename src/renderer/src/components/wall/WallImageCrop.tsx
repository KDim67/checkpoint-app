/** the whole picture where it lies on the wall, dimmed outside a window: drag the window, keep what is inside */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, X, Undo2 } from 'lucide-react'
import type { ImageCrop, WallItem } from '../../../../shared/wallModel'
import { cropOf, dragCrop, fitRatio, FULL_CROP, pixelRatio, type CropHandle } from '../../../../shared/wallCrop'
import { toLocal } from '../../../../shared/wallTurn'
import { ToolbarDivider } from './wallTextControls'

interface Props {
  item: WallItem
  /** the camera's zoom, so grips and words stay one size on screen */
  zoom: number
  /** the part kept, as fractions of the whole picture */
  onApply: (crop: ImageCrop) => void
  onCancel: () => void
}

type Grip = Exclude<CropHandle, 'move'>

/** corner and edge grips, as fractions along the window they sit on, and the way each faces before any turn */
const GRIPS: { handle: Grip; across: number; down: number; facing: number }[] = [
  { handle: 'nw', across: 0, down: 0, facing: 315 },
  { handle: 'n', across: 0.5, down: 0, facing: 0 },
  { handle: 'ne', across: 1, down: 0, facing: 45 },
  { handle: 'e', across: 1, down: 0.5, facing: 90 },
  { handle: 'se', across: 1, down: 1, facing: 135 },
  { handle: 's', across: 0.5, down: 1, facing: 180 },
  { handle: 'sw', across: 0, down: 1, facing: 225 },
  { handle: 'w', across: 0, down: 0.5, facing: 270 }
]

const RESIZE_CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize']

/** the arrow that points the way a grip pulls once the picture is turned */
const cursorFor = (facing: number, rotation: number): string =>
  RESIZE_CURSORS[Math.round((((facing + rotation) % 180) + 180) % 180 / 45) % 4]

type Shape = 'free' | 'original' | 'square' | 'standard' | 'wide'

/** a portrait picture gets the upright versions of the usual shapes */
const shapesFor = (portrait: boolean): { shape: Shape; label: string; ratio: (original: number) => number }[] => [
  { shape: 'free', label: 'Free', ratio: () => 0 },
  { shape: 'original', label: 'Original', ratio: original => original },
  { shape: 'square', label: '1:1', ratio: () => 1 },
  { shape: 'standard', label: portrait ? '3:4' : '4:3', ratio: () => (portrait ? 3 / 4 : 4 / 3) },
  { shape: 'wide', label: portrait ? '9:16' : '16:9', ratio: () => (portrait ? 9 / 16 : 16 / 9) }
]

/** keys meant for a box being typed in, the wall's search for one, are left to it */
const typing = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))

/** a screen pixel of nudge, ten with Shift */
const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

/** a press on the bar keeps the focus where it was and never reaches the wall */
const holdFocus = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() }

const sameCrop = (a: ImageCrop, b: ImageCrop): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export default function WallImageCrop({ item, zoom, onApply, onCancel }: Props): React.JSX.Element {
  const [crop, setCrop] = useState<ImageCrop>(() => cropOf(item))
  const [shape, setShape] = useState<Shape>('free')
  const [dragging, setDragging] = useState(false)
  /** the picture's own pixels, for the size readout */
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // the whole picture at the size it shows on the wall, laid out around the item so nothing moves
  const now = cropOf(item)
  const picture = { width: item.width / now.w, height: item.height / now.h }
  const rotation = item.rotation ?? 0
  const portrait = picture.height > picture.width
  const shapes = shapesFor(portrait)
  const lockedRatio = shape === 'free' ? null : (shapes.find(s => s.shape === shape)?.ratio(picture.width / picture.height) ?? null)

  /** done once, whichever way it ends; read through a ref so listeners see the latest window */
  const settledRef = useRef(false)
  const latest = useRef({ crop, item, onApply, onCancel })
  latest.current = { crop, item, onApply, onCancel }

  const finish = (): void => {
    if (settledRef.current) return
    settledRef.current = true
    const { crop: kept, item: target } = latest.current
    if (sameCrop(kept, cropOf(target))) latest.current.onCancel()
    else latest.current.onApply(kept)
  }
  const cancel = (): void => {
    if (settledRef.current) return
    settledRef.current = true
    latest.current.onCancel()
  }

  // a press anywhere else keeps the crop, before the wall acts on that press, the way Google Slides does
  const spaceRef = useRef(false)
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      // middle-button and space drags pan the wall and leave the window open
      if (e.button !== 0 || spaceRef.current) return
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return
      finish()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Space') spaceRef.current = e.type === 'keydown'
      if (e.type !== 'keydown') return
      if (e.key === 'Escape') {
        e.preventDefault()
        // first Esc leaves the crop and nothing else; the picture stays selected
        e.stopPropagation()
        cancel()
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement) && !typing(e.target)) {
        e.preventDefault()
        e.stopPropagation()
        finish()
      } else if (NUDGE[e.key] && !typing(e.target)) {
        e.preventDefault()
        // the window moves, not the picture under it
        e.stopPropagation()
        const step = e.shiftKey ? 10 : 1
        const [lx, ly] = toLocal(NUDGE[e.key][0] * step, NUDGE[e.key][1] * step, rotation)
        setCrop(c => dragCrop(c, 'move', lx / zoom / picture.width, ly / zoom / picture.height))
      }
    }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  })

  // closed some other way, by choosing something else or switching walls: a changed window is kept
  useEffect(() => () => {
    const { crop: kept, item: target } = latest.current
    if (!settledRef.current && !sameCrop(kept, cropOf(target))) {
      settledRef.current = true
      latest.current.onApply(kept)
    }
  }, [])

  const grab = (handle: CropHandle) => (e: ReactPointerEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const from = crop
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    setDragging(true)

    const move = (ev: PointerEvent): void => {
      const [lx, ly] = toLocal(ev.clientX - startX, ev.clientY - startY, rotation)
      const corner = handle.length === 2
      // a chosen shape holds; otherwise Shift on a corner keeps the one it has
      const ratio = lockedRatio ?? (corner && ev.shiftKey ? pixelRatio(from, picture) : null)
      setCrop(dragCrop(from, handle, lx / zoom / picture.width, ly / zoom / picture.height, ratio ? { ratio, picture } : undefined))
    }
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
      setDragging(false)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }

  const pickShape = (next: Shape, ratio: number): void => {
    setShape(next)
    if (next !== 'free') setCrop(c => fitRatio(c, ratio, picture))
  }

  const window_: CSSProperties = {
    left: `${crop.x * 100}%`,
    top: `${crop.y * 100}%`,
    width: `${crop.w * 100}%`,
    height: `${crop.h * 100}%`
  }

  // below the whole picture as the screen sees it, however the picture is turned
  const turn = (rotation * Math.PI) / 180
  const reach = (picture.width * Math.abs(Math.sin(turn)) + picture.height * Math.abs(Math.cos(turn))) / 2
  const upright = `rotate(${-rotation}deg)`
  const src = `checkpoint-media://${item.ref}`

  return (
    <div
      ref={rootRef}
      data-wall-ui
      role="group"
      aria-label="Crop this image"
      className="wall-crop"
      onPointerDown={e => e.stopPropagation()}
      onDoubleClick={e => {
        // double-clicking the picture again is done, as it is in most editors
        e.stopPropagation()
        finish()
      }}
      style={{
        left: `${-now.x * picture.width}px`,
        top: `${-now.y * picture.height}px`,
        width: `${picture.width}px`,
        height: `${picture.height}px`,
        ['--crop-inv' as string]: 1 / zoom
      }}
    >
      <div className="wall-crop-stage">
        <img src={`${src}?w=${Math.round(picture.width * 2)}`} alt="" draggable={false} className="wall-crop-picture" />
        <div className="wall-crop-window" style={window_}>
          {dragging && <div className="wall-crop-grid" aria-hidden="true" />}
        </div>
      </div>

      <div className="wall-crop-move" style={window_} onPointerDown={grab('move')} aria-hidden="true" />

      {GRIPS.filter(g => lockedRatio === null || g.handle.length === 2).map(grip => (
        <div
          key={grip.handle}
          className="wall-crop-grip"
          data-grip={grip.handle}
          onPointerDown={grab(grip.handle)}
          role="slider"
          aria-label={`Crop edge ${grip.handle}`}
          aria-valuetext={`${Math.round(crop.w * 100)} by ${Math.round(crop.h * 100)} percent of the picture`}
          style={{
            left: `${(crop.x + crop.w * grip.across) * 100}%`,
            top: `${(crop.y + crop.h * grip.down) * 100}%`,
            cursor: cursorFor(grip.facing, rotation)
          }}
        >
          <span className="wall-crop-mark" />
        </div>
      ))}

      {dragging && natural && (
        <div
          className="wall-crop-size"
          style={{
            left: `${(crop.x + crop.w / 2) * 100}%`,
            top: `${(crop.y + crop.h / 2) * 100}%`,
            transform: `${upright} scale(var(--crop-inv)) translate(-50%, -50%)`
          }}
        >
          {Math.round(crop.w * natural.width)} × {Math.round(crop.h * natural.height)} px
        </div>
      )}

      {/* the original, read for its own size only */}
      {!natural && (
        <img
          src={src}
          alt=""
          className="is-hidden"
          onLoad={e => setNatural({
            width: (e.currentTarget as HTMLImageElement).naturalWidth,
            height: (e.currentTarget as HTMLImageElement).naturalHeight
          })}
        />
      )}

      <div
        className="wall-crop-bar"
        style={{ transform: `${upright} translateY(calc(${reach}px + var(--space-3) * var(--crop-inv))) scale(var(--crop-inv)) translateX(-50%)` }}
      >
        <div className="wall-tb-group" role="group" aria-label="Shape">
          {shapes.map(s => (
            <button
              key={s.shape}
              type="button"
              className="wall-tb-button"
              aria-pressed={shape === s.shape}
              title={s.shape === 'free' ? 'Any shape' : s.shape === 'original' ? "The picture's own shape" : `Keep it ${s.label}`}
              {...holdFocus}
              onClick={() => pickShape(s.shape, s.ratio(picture.width / picture.height))}
            >
              {s.label}
            </button>
          ))}
        </div>
        <ToolbarDivider />
        <button type="button" className="wall-tb-button" title="Whole picture" aria-label="Whole picture" {...holdFocus} onClick={() => { setShape('free'); setCrop(FULL_CROP) }}>
          <Undo2 size={14} aria-hidden="true" />
        </button>
        <button type="button" className="wall-tb-button" title="Cancel (Esc)" aria-label="Cancel" {...holdFocus} onClick={cancel}>
          <X size={14} aria-hidden="true" />
        </button>
        <button type="button" className="wall-crop-done" title="Done (Enter)" {...holdFocus} onClick={finish}>
          <Check size={14} aria-hidden="true" />
          Done
        </button>
      </div>
    </div>
  )
}
