/** the OS picker ignores the theme and can't be styled, so our own square, hue bar and hex field */

import React, { useEffect, useRef, useState } from 'react'
import { hexToHsv, hsvToHex, isHex, type Hsv } from '../../../../shared/color'

interface Props {
  value: string
  onChange: (hex: string) => void
  /** fires when the gesture ends, for persist-on-commit */
  onCommit?: (hex: string) => void
}

const FALLBACK: Hsv = { h: 42, s: 0.66, v: 0.96 }

export default function ColorField({ value, onChange, onCommit }: Props): React.JSX.Element {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value) ?? FALLBACK)
  const [typed, setTyped] = useState(value)
  const areaRef = useRef<HTMLDivElement>(null)
  const hueRef = useRef<HTMLDivElement>(null)

  // follows the outside value except mid-drag
  const draggingRef = useRef(false)
  useEffect(() => {
    if (draggingRef.current) return
    const next = hexToHsv(value)
    if (next) setHsv(next)
    setTyped(value)
  }, [value])

  const emit = (next: Hsv): void => {
    setHsv(next)
    const hex = hsvToHex(next)
    setTyped(hex)
    onChange(hex)
  }

  /** both surfaces: capture, track, release */
  const track = (
    ref: React.RefObject<HTMLDivElement | null>,
    read: (fx: number, fy: number) => Hsv
  ) => (e: React.PointerEvent) => {
    const el = ref.current
    if (!el) return

    draggingRef.current = true
    el.setPointerCapture(e.pointerId)

    const apply = (clientX: number, clientY: number): void => {
      const rect = el.getBoundingClientRect()
      const fx = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const fy = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
      emit(read(fx, fy))
    }

    apply(e.clientX, e.clientY)

    const move = (ev: PointerEvent): void => apply(ev.clientX, ev.clientY)
    const up = (): void => {
      draggingRef.current = false
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      onCommit?.(hsvToHex(hsvRef.current))
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
  }

  // listeners close over bind-time state, read the latest from a ref
  const hsvRef = useRef(hsv)
  hsvRef.current = hsv

  const hex = hsvToHex(hsv)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', width: '196px' }}>
      {/* saturation across, value down */}
      <div
        ref={areaRef}
        onPointerDown={track(areaRef, (fx, fy) => ({ ...hsvRef.current, s: fx, v: 1 - fy }))}
        role="slider"
        aria-label="Saturation and brightness"
        aria-valuetext={hex}
        tabIndex={0}
        style={{
          position: 'relative', height: '116px', borderRadius: 'var(--radius-md)',
          cursor: 'crosshair', touchAction: 'none',
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
          border: '1px solid var(--color-surface-offset)'
        }}
      >
        <span style={{
          position: 'absolute',
          left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`,
          width: '12px', height: '12px', marginLeft: '-6px', marginTop: '-6px',
          borderRadius: '50%', background: hex, pointerEvents: 'none',
          boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.4)'
        }} />
      </div>

      <div
        ref={hueRef}
        onPointerDown={track(hueRef, fx => ({ ...hsvRef.current, h: fx * 360 }))}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        tabIndex={0}
        style={{
          position: 'relative', height: '12px', borderRadius: '999px',
          cursor: 'pointer', touchAction: 'none',
          background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
          border: '1px solid var(--color-surface-offset)'
        }}
      >
        <span style={{
          position: 'absolute', left: `${(hsv.h / 360) * 100}%`, top: '50%',
          width: '14px', height: '14px', marginLeft: '-7px', marginTop: '-7px',
          borderRadius: '50%', background: `hsl(${hsv.h} 100% 50%)`, pointerEvents: 'none',
          boxShadow: '0 0 0 2px #fff, 0 0 0 3px rgba(0,0,0,0.4)'
        }} />
      </div>

      <div className="row">
        <span style={{
          width: '24px', height: '24px', flexShrink: 0, borderRadius: 'var(--radius-sm)',
          background: hex, border: '1px solid var(--color-surface-offset)'
        }} />
        <input
          value={typed}
          onChange={e => {
            setTyped(e.target.value)
            // only whole hex values, so the square doesn't lurch mid-typing
            if (isHex(e.target.value)) {
              const next = hexToHsv(e.target.value)
              if (next) { setHsv(next); onChange(hsvToHex(next)) }
            }
          }}
          onBlur={() => { setTyped(hex); onCommit?.(hex) }}
          spellCheck={false}
          aria-label="Hex colour"
          style={{
            flex: 1, minWidth: 0,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-base)',
            fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
            padding: '4px 6px', outline: 'none'
          }}
        />
      </div>
    </div>
  )
}
