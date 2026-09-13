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
  /** 1 gives the ink palette's vertical strip */
  columns?: number
  /** follow-the-theme option */
  defaultLabel?: string
  onDefault?: () => void
  /** any colour via our picker */
  allowCustom?: boolean
}

/** clickable without the dot growing */
const TARGET = 26
const DOT = 18

export default function WallColorPicker({
  colors, value, onChange, columns = 4, defaultLabel, onDefault, allowCustom = true
}: Props): React.JSX.Element {
  const isCustom = !!value && !colors.includes(value)
  /** portal on body: the palette's centring transform trapped fixed panels in a clipping scroller */
  const [customAt, setCustomAt] = useState<{ left: number; top: number } | null>(null)
  const customRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const customOpen = customAt !== null

  useEffect(() => {
    if (!customOpen) return
    const onDown = (e: PointerEvent): void => {
      // no longer a DOM child, needs its own outside check
      const target = e.target as Node
      if (customRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setCustomAt(null)
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
          : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
        transition: 'box-shadow var(--duration-fast) var(--ease-default)'
      }}>
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </button>
  )

  return (
    <div className="col-6px">
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
          <div ref={customRef} className="relative">
            <button
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
                // the wheel says anything
                background: isCustom
                  ? value
                  : `conic-gradient(${[...colors, colors[0]].join(', ')})`,
                boxShadow: isCustom
                  ? '0 0 0 2px var(--color-surface-elevated), 0 0 0 4px var(--color-secondary)'
                  : 'inset 0 0 0 1px rgba(0,0,0,0.28)',
                transition: 'box-shadow var(--duration-fast) var(--ease-default)'
              }} />
            </button>

            {customAt && createPortal(
              // still tagged: React bubbles through the component tree to the canvas
              <div
                ref={panelRef}
                data-wall-ui
                style={{
                  position: 'fixed', left: `${customAt.left}px`, top: `${customAt.top}px`, zIndex: 60,
                  padding: 'var(--space-3)',
                  background: 'var(--color-surface-elevated)',
                  border: '1px solid var(--color-surface-offset)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: 'var(--shadow-lg)'
                }}
              >
                <ColorField value={isCustom && value ? value : colors[0]} onChange={onChange} />
              </div>,
              document.body
            )}
          </div>
        )}
      </div>
    </div>
  )
}
