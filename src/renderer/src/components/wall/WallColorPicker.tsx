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

import React from 'react'
import { Check } from 'lucide-react'
import { getTextColorForBackground } from '../../lib/contrast'

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
          <label
            title="Any colour"
            style={{
              width: `${TARGET}px`, height: `${TARGET}px`, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative'
            }}
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
            <input
              type="color"
              value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#f6c453'}
              onChange={e => onChange(e.target.value)}
              aria-label="Custom colour"
              // Covers the swatch so the whole circle opens the OS picker, while
              // the styled span is what is actually seen.
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', border: 'none', padding: 0 }}
            />
          </label>
        )}
      </div>
    </div>
  )
}
