/**
 * The Wall's swatch grid.
 *
 * One component for the three places that were each drawing their own row of
 * circles: the ink palette, the background picker and the selection toolbar.
 * They had drifted to different sizes, different selected states and, in one
 * case, no custom colour at all.
 *
 * The custom swatch is a native colour input wearing a swatch: the OS picker is
 * better than anything worth hand-building, and this keeps it looking like the
 * rest of the row.
 */

import React, { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { getTextColorForBackground } from '../../lib/contrast'
import ColorField from '../ui/ColorField'

interface Props {
  colors: string[]
  /** The chosen colour, or undefined when the default is in force. */
  value?: string
  onChange: (color: string) => void
  /** How many swatches per row. 1 gives the vertical strip the ink palette uses. */
  columns?: number
  /** Offers "no colour of its own", for the background's follow-the-theme case. */
  defaultLabel?: string
  onDefault?: () => void
  /** Offers any colour at all through the OS picker. */
  allowCustom?: boolean
}

/** Comfortably clickable without the dot having to grow to match. */
const TARGET = 26
const DOT = 18

export default function WallColorPicker({
  colors, value, onChange, columns = 4, defaultLabel, onDefault, allowCustom = true
}: Props): React.JSX.Element {
  const isCustom = !!value && !colors.includes(value)
  /**
   * Where to draw the panel, in viewport coordinates.
   *
   * Fixed rather than absolute because the pen palette scrolls: an absolutely
   * positioned panel was a child of that scroller, so it could not escape it
   * and only ever produced scrollbars.
   */
  const [customAt, setCustomAt] = useState<{ left: number; top: number } | null>(null)
  const customRef = useRef<HTMLDivElement>(null)
  const customOpen = customAt !== null

  useEffect(() => {
    if (!customOpen) return
    const onDown = (e: PointerEvent): void => {
      if (!customRef.current?.contains(e.target as Node)) setCustomAt(null)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setCustomAt(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [customOpen])

  const swatch = (color: string, selected: boolean, label: string, onClick: () => void): React.JSX.Element => (
    <button
      key={label}
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      style={{
        width: `${TARGET}px`, height: `${TARGET}px`, padding: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'none', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        transition: 'transform var(--duration-fast) var(--ease-default)'
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
      // Transform only, so hovering a swatch cannot reflow the row.
      onFocus={e => { e.currentTarget.style.transform = 'scale(1.1)' }}
      onBlur={e => { e.currentTarget.style.transform = 'none' }}
    >
      <span style={{
        width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%', background: color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: getTextColorForBackground(color),
        // A ring with a gap rather than a border: a border eats into the colour
        // and reads as a different shade at these sizes.
        boxShadow: selected
          ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 4px var(--color-secondary)'
          : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
        transition: 'box-shadow var(--duration-fast) var(--ease-default)'
      }}>
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {defaultLabel && onDefault && (
        <button
          onClick={onDefault}
          aria-pressed={!value}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', width: '100%',
            padding: 'var(--space-1) var(--space-2)', cursor: 'pointer',
            background: !value ? 'var(--color-secondary-muted)' : 'none',
            border: 'none', borderRadius: 'var(--radius-sm)',
            color: !value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
            fontSize: 'var(--text-xs)',
            transition: 'background var(--duration-fast) var(--ease-default)'
          }}
        >
          <Check size={12} style={{ opacity: value ? 0 : 1 }} />
          {defaultLabel}
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, ${TARGET}px)`, gap: '4px' }}>
        {colors.map(color => swatch(color, value === color, color, () => onChange(color)))}

        {allowCustom && (
          <div ref={customRef} style={{ position: 'relative' }}>
            <button
              onClick={e => {
                if (customOpen) { setCustomAt(null); return }
                const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
                // Kept inside the window: the panel is 220 by 210 or so, and
                // near a bottom corner it would otherwise open off-screen.
                setCustomAt({
                  left: Math.min(box.right + 10, window.innerWidth - 232),
                  top: Math.min(box.top, window.innerHeight - 232)
                })
              }}
              title="Any colour"
              aria-label="Custom colour"
              aria-expanded={customOpen}
              style={{
                width: `${TARGET}px`, height: `${TARGET}px`, padding: 0, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'none', border: 'none', borderRadius: 'var(--radius-sm)',
                transition: 'transform var(--duration-fast) var(--ease-default)'
              }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.1)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
            >
              <span style={{
                width: `${DOT}px`, height: `${DOT}px`, borderRadius: '50%',
                // The colour wheel says "anything", which a single sample cannot.
                background: isCustom
                  ? value
                  : `conic-gradient(${[...colors, colors[0]].join(', ')})`,
                boxShadow: isCustom
                  ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 4px var(--color-secondary)'
                  : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
                transition: 'box-shadow var(--duration-fast) var(--ease-default)'
              }} />
            </button>

            {customAt && (
              <div style={{
                position: 'fixed', left: `${customAt.left}px`, top: `${customAt.top}px`, zIndex: 60,
                padding: 'var(--space-3)',
                background: 'var(--color-surface-elevated)',
                border: '1px solid var(--color-surface-offset)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg)'
              }}>
                <ColorField value={isCustom && value ? value : colors[0]} onChange={onChange} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
