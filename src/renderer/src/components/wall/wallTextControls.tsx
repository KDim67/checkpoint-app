/** text controls laid out the way Google Docs has them: a font by name, a size you can step or type, an A for colour, and alignment as three buttons */

import React, { useEffect, useRef, useState } from 'react'
import { ChevronDown, Minus, Plus } from 'lucide-react'
import { MAX_FONT_SIZE, MIN_FONT_SIZE, TEXT_ALIGNS, WALL_COLORS, WALL_FONT_NAMES, type TextAlign, type WallFont } from '../../../../shared/wallModel'
import WallColorPicker from './WallColorPicker'
import { ALIGN_GLYPHS, FontPickerMenu, TextSizeMenu, fontCssFamily } from './wallButtons'

/** keeps the words selected: a press on a control never takes the focus or reaches the wall underneath */
const holdFocus = {
  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
  onPointerDown: (e: React.PointerEvent) => e.stopPropagation()
}

/** a menu that closes when the pointer goes down anywhere else */
function usePopover(): { open: boolean; setOpen: (open: boolean) => void; ref: React.RefObject<HTMLDivElement> } {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])
  return { open, setOpen, ref }
}

export function StyleToggle({ label, active, disabled, onToggle, children }: {
  label: string
  active: boolean
  disabled?: boolean
  onToggle: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button type="button" data-wall-ui className="wall-tb-button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} {...holdFocus} onClick={onToggle}>
      {children}
    </button>
  )
}

export const ToolbarDivider = (): React.JSX.Element => <span className="wall-tb-divider" aria-hidden="true" />

/** the font's name, set in that font; empty when the words differ */
export function FontSelect({ value, onPick, onDone }: { value: WallFont | null; onPick: (font: WallFont) => void; onDone?: () => void }): React.JSX.Element {
  const { open, setOpen, ref } = usePopover()
  return (
    <div ref={ref} className="wall-tb-anchor">
      <button
        type="button"
        data-wall-ui
        className="wall-tb-button wall-tb-font"
        title="Font"
        aria-label={`Font: ${value ? WALL_FONT_NAMES[value] : 'mixed'}`}
        aria-expanded={open}
        aria-haspopup="menu"
        {...holdFocus}
        onClick={() => setOpen(!open)}
      >
        <span className="wall-tb-font-name" style={value ? { fontFamily: fontCssFamily(value) } : undefined}>{value ? WALL_FONT_NAMES[value] : 'Font'}</span>
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="wall-tb-popover" data-wall-ui {...holdFocus}>
          <FontPickerMenu
            current={value ?? undefined}
            onPick={font => {
              onPick(font)
              setOpen(false)
              onDone?.()
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

const clampSize = (n: number): number => Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(n)))

/** − 32 +: steps a point at a time, takes any size typed, and lists the usual ones while it's being typed in */
export function SizeStepper({ value, stepFrom, fit, onPick, onDone }: {
  /** null when the words differ */
  value: number | null
  /** where − and + start from when the words differ */
  stepFrom: number
  /** offered for boxes whose words can shrink to fit them; active while they do */
  fit?: { active: boolean }
  onPick: (size: number | undefined) => void
  onDone?: () => void
}): React.JSX.Element {
  const { open, setOpen, ref } = usePopover()
  const shown = fit?.active ? '' : value === null ? '' : String(value)
  const [draft, setDraft] = useState(shown)
  useEffect(() => setDraft(shown), [shown])

  const commit = (text: string): void => {
    const n = Number(text)
    if (text.trim() && Number.isFinite(n)) onPick(clampSize(n))
    else setDraft(shown)
  }
  const step = (by: number): void => onPick(clampSize((value ?? stepFrom) + by))

  return (
    <div ref={ref} className="wall-tb-anchor wall-tb-size" role="group" aria-label="Text size">
      <button type="button" data-wall-ui className="wall-tb-button wall-tb-step" title="Smaller" aria-label="Smaller" {...holdFocus} onClick={() => step(-1)}>
        <Minus size={12} aria-hidden="true" />
      </button>
      <input
        data-wall-ui
        className="wall-tb-size-field"
        // a box to type in that opens a list, as Google Docs' is
        role="combobox"
        aria-label="Size"
        aria-expanded={open}
        aria-haspopup="menu"
        inputMode="numeric"
        value={draft}
        placeholder={fit?.active ? 'Fit' : ''}
        onPointerDown={e => e.stopPropagation()}
        onFocus={e => {
          setOpen(true)
          e.currentTarget.select()
        }}
        onChange={e => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit(draft)
            setOpen(false)
            onDone?.()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            setDraft(shown)
            setOpen(false)
            onDone?.()
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(e.key === 'ArrowUp' ? 1 : -1)
          }
        }}
        onBlur={() => {
          if (draft !== shown) commit(draft)
        }}
      />
      <button type="button" data-wall-ui className="wall-tb-button wall-tb-step" title="Bigger" aria-label="Bigger" {...holdFocus} onClick={() => step(1)}>
        <Plus size={12} aria-hidden="true" />
      </button>
      {open && (
        <div className="wall-tb-popover" data-wall-ui {...holdFocus}>
          <TextSizeMenu
            current={value ?? stepFrom}
            chosen={!fit?.active && value !== null}
            fit={fit !== undefined}
            onPick={size => {
              onPick(size)
              setOpen(false)
              onDone?.()
            }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  )
}

/** an A underlined in the colour; the bar is dashed when the words differ */
export function ColorA({ value, fallback, label = 'Text colour', defaultLabel = 'Default', onPick, onDone }: {
  /** undefined: no colour of its own, so the fallback shows; null: the words differ */
  value: string | null | undefined
  fallback: string
  label?: string
  defaultLabel?: string
  /** final is false while a custom colour is still being dragged */
  onPick: (color: string | null, final: boolean) => void
  onDone?: () => void
}): React.JSX.Element {
  const { open, setOpen, ref } = usePopover()
  return (
    <div ref={ref} className="wall-tb-anchor">
      <button type="button" data-wall-ui className="wall-tb-button wall-tb-color" title={label} aria-label={label} aria-expanded={open} {...holdFocus} onClick={() => setOpen(!open)}>
        <span className="wall-tb-color-letter" aria-hidden="true">A</span>
        <span
          className="wall-tb-color-bar"
          data-mixed={value === null ? 'true' : undefined}
          style={value === null ? undefined : { background: value ?? fallback }}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="wall-tb-popover wall-tb-popover-padded" data-wall-ui onPointerDown={e => e.stopPropagation()}>
          <WallColorPicker
            colors={WALL_COLORS}
            value={value ?? undefined}
            onChange={c => onPick(c, false)}
            onCommit={c => onPick(c, true)}
            onDefault={() => {
              onPick(null, true)
              setOpen(false)
              onDone?.()
            }}
            defaultLabel={defaultLabel}
            onDone={() => {
              setOpen(false)
              onDone?.()
            }}
            columns={4}
          />
        </div>
      )}
    </div>
  )
}

const ALIGN_NAMES: Record<TextAlign, string> = { left: 'Align left', center: 'Centre', right: 'Align right' }

/** three buttons, one pressed; none pressed when the lines differ */
export function AlignButtons({ value, onPick }: { value: TextAlign | null; onPick: (align: TextAlign) => void }): React.JSX.Element {
  return (
    <div className="wall-tb-group" role="group" aria-label="Alignment">
      {TEXT_ALIGNS.map(side => (
        <StyleToggle key={side} label={ALIGN_NAMES[side]} active={value === side} onToggle={() => onPick(side)}>
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d={ALIGN_GLYPHS[side]} />
          </svg>
        </StyleToggle>
      ))}
    </div>
  )
}
