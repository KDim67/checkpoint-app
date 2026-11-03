/** one swatch grid for ink, background and selection; the custom swatch opens our picker, not the OS one */

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { getTextColorForBackground } from '../../lib/contrast'
import ColorField from '../ui/ColorField'

interface Props {
  colors: string[]
  /** undefined for the default */
  value?: string
  onChange: (color: string) => void
  /** the end of the gesture: onChange paints as it goes, this records one undo step */
  onCommit?: (color: string) => void
  /** a swatch was picked, so a caller that opened this can close it; dragging a colour never does */
  onDone?: () => void
  /** 1 gives the ink palette's vertical strip */
  columns?: number
  /** follow-the-theme option */
  defaultLabel?: string
  onDefault?: () => void
  onDefaultPreview?: () => void
  /** any colour via our picker */
  allowCustom?: boolean
}

/** clickable without the dot growing */
const TARGET = 26
const DOT = 18

export default function WallColorPicker({
  colors, value, onChange, onCommit, onDone, columns = 4, defaultLabel, onDefault, onDefaultPreview, allowCustom = true
}: Props): React.JSX.Element {
  const [committedValue, setCommittedValue] = useState<string | undefined>(value)
  const [hoveredColor, setHoveredColor] = useState<string | null>(null)
  const isCustom = !!committedValue && !colors.includes(committedValue)
  /** portal on body: the palette's centring transform trapped fixed panels in a clipping scroller */
  const [customAt, setCustomAt] = useState<{ left: number; top: number } | null>(null)
  const customRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const customOpen = customAt !== null

  const initialValueRef = useRef(value)
  const committedRef = useRef(false)
  const isDraggingRef = useRef(false)
  const isHoveringRef = useRef(false)

  useEffect(() => {
    if (!isHoveringRef.current && !isDraggingRef.current) {
      initialValueRef.current = value
      setCommittedValue(value)
      committedRef.current = false
    }
  }, [value])

  const handleHover = (color: string): void => {
    isHoveringRef.current = true
    setHoveredColor(color)
    onChange(color)
  }

  const handleDefaultHover = (): void => {
    isHoveringRef.current = true
    setHoveredColor('__default__')
    if (onDefaultPreview) {
      onDefaultPreview()
    } else if (onDefault) {
      onDefault()
    }
  }

  const handleLeave = (): void => {
    if (customOpen) return
    if (!isHoveringRef.current) return
    isHoveringRef.current = false
    setHoveredColor(null)
    if (!committedRef.current && !isDraggingRef.current) {
      if (initialValueRef.current !== undefined) {
        onChange(initialValueRef.current)
      } else if (onDefaultPreview) {
        onDefaultPreview()
      } else if (onDefault) {
        onDefault()
      }
    }
  }

  const handlePick = (color: string): void => {
    isHoveringRef.current = false
    committedRef.current = true
    setCommittedValue(color)
    initialValueRef.current = color
    setHoveredColor(null)
    onChange(color)
    onCommit?.(color)
    onDone?.()
  }

  const handleDefaultClick = (): void => {
    isHoveringRef.current = false
    committedRef.current = true
    setCommittedValue(undefined)
    initialValueRef.current = undefined
    setHoveredColor(null)
    onDefault?.()
    onDone?.()
  }

  const callbacksRef = useRef({ onChange, onDefault, onDefaultPreview })
  callbacksRef.current = { onChange, onDefault, onDefaultPreview }

  useEffect(() => {
    if (!customOpen) return
    const onDown = (e: PointerEvent): void => {
      // no longer a DOM child, needs its own outside check
      const target = e.target as Node
      if (customRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setCustomAt(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setCustomAt(null)
        if (!committedRef.current) {
          if (initialValueRef.current !== undefined) callbacksRef.current.onChange(initialValueRef.current)
          else if (callbacksRef.current.onDefaultPreview) callbacksRef.current.onDefaultPreview()
          else if (callbacksRef.current.onDefault) callbacksRef.current.onDefault()
        }
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [customOpen])

  const swatch = (color: string, selected: boolean, hovered: boolean, label: string): React.JSX.Element => (
    <button
      key={label}
      type="button"
      data-swatch-color={color}
      onPointerEnter={() => handleHover(color)}
      onMouseDown={e => e.preventDefault()}
      onClick={() => handlePick(color)}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      // transform only, no reflow on hover
      className="hover-grow wall-color-picker-swatch"
      style={{
        width: `${TARGET}px`, height: `${TARGET}px`, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        transition: 'transform var(--duration-fast) var(--ease-default)'
      }}
    >
      <span style={{
        width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: getTextColorForBackground(color),
        // gapped ring, a border eats the colour
        boxShadow: selected
          ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 4px var(--color-secondary)'
          : hovered
            ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 3px var(--color-text-muted)'
            : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
        transition: 'box-shadow var(--duration-fast) var(--ease-default)'
      }}>
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  )

  return (
    <div className="col-6px" onPointerLeave={handleLeave}>
      {defaultLabel && onDefault && (
        <button
          type="button"
          onPointerEnter={handleDefaultHover}
          onMouseEnter={handleDefaultHover}
          onMouseDown={e => e.preventDefault()}
          onClick={handleDefaultClick}
          aria-pressed={!committedValue}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
            whiteSpace: 'nowrap',
            padding: 'var(--space-1) var(--space-2)', cursor: 'pointer',
            background: !committedValue
              ? 'var(--color-secondary-muted)'
              : (hoveredColor === '__default__' ? 'var(--color-surface-offset)' : 'none'),
            border: 'none', borderRadius: 'var(--radius-sm)',
            color: !committedValue ? 'var(--color-secondary)' : 'var(--color-text-muted)',
            fontSize: 'var(--text-xs)',
            transition: 'background var(--duration-fast) var(--ease-default)'
          }}
        >
          <Check size={12} style={{ opacity: !committedValue ? 1 : 0, flexShrink: 0 }} />
          <span>{defaultLabel}</span>
        </button>
      )}

      <div
        onPointerDown={e => {
          const target = (e.target as HTMLElement).closest<HTMLElement>('[data-swatch-color]')
          if (target) {
            isDraggingRef.current = true
            const col = target.getAttribute('data-swatch-color')
            if (col) handleHover(col)
          }
        }}
        onPointerMove={e => {
          if (!isDraggingRef.current) return
          const el = document.elementFromPoint(e.clientX, e.clientY)
          const swatchEl = el?.closest<HTMLElement>('[data-swatch-color]')
          const col = swatchEl?.getAttribute('data-swatch-color')
          if (col) handleHover(col)
        }}
        onPointerUp={e => {
          if (isDraggingRef.current) {
            isDraggingRef.current = false
            const el = document.elementFromPoint(e.clientX, e.clientY)
            const swatchEl = el?.closest<HTMLElement>('[data-swatch-color]')
            const col = swatchEl?.getAttribute('data-swatch-color')
            if (col) {
              handlePick(col)
            }
          }
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, ${TARGET}px)`,
          gap: '4px',
          justifyContent: 'center',
          touchAction: 'none'
        }}
      >
        {/* a swatch is the whole gesture: paint it, record it, and let the caller close */}
        {colors.map(color => swatch(
          color,
          committedValue === color,
          hoveredColor === color && committedValue !== color,
          color
        ))}

        {allowCustom && (
          <div ref={customRef} className="relative">
            <button
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={e => {
                if (customOpen) { setCustomAt(null); return }
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                // kept in the window, ~220x210 opens off-screen near edges
                setCustomAt({
                  left: Math.max(8, Math.min(box.right + 10, window.innerWidth - 232)),
                  top: Math.max(8, Math.min(box.top, window.innerHeight - 232))
                })
              }}
              title="Any colour"
              aria-label="Custom colour"
              aria-expanded={customOpen}
              aria-pressed={isCustom}
              className="hover-grow"
              style={{
                width: `${TARGET}px`, height: `${TARGET}px`, padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                transition: 'transform var(--duration-fast) var(--ease-default)'
              }}
            >
              <span style={{
                width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: isCustom && committedValue ? getTextColorForBackground(committedValue) : undefined,
                // the wheel says anything
                background: isCustom
                  ? committedValue
                  : `conic-gradient(${[...colors, colors[0]].join(', ')})`,
                boxShadow: isCustom
                  ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 4px var(--color-secondary)'
                  : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
                transition: 'box-shadow var(--duration-fast) var(--ease-default)'
              }}>
                {isCustom && <Check size={11} strokeWidth={3} />}
              </span>
            </button>

            {customAt && createPortal(
              // still tagged: React bubbles through the component tree to the canvas
              <div
                ref={panelRef}
                data-wall-ui
                // a press here is the picker's own; outside-click closers above would shut it mid-drag
                onPointerDown={e => e.stopPropagation()}
                onMouseDown={e => e.stopPropagation()}
                style={{
                  position: 'fixed', left: `${customAt.left}px`, top: `${customAt.top}px`, zIndex: 60,
                  padding: 'var(--space-3)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)'
                }}
              >
                <ColorField
                  value={isCustom && committedValue ? committedValue : (value || colors[0])}
                  onChange={onChange}
                  onCommit={c => {
                    committedRef.current = true
                    setCommittedValue(c)
                    initialValueRef.current = c
                    setHoveredColor(null)
                    if (onCommit) onCommit(c)
                    else onChange(c)
                  }}
                />
              </div>,
              document.body
            )}
          </div>
        )}
      </div>
    </div>
  )
}
