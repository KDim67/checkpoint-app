import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import ColorField from './ColorField'

export interface ColorPickerProps {
  value: string
  onChange?: (color: string) => void
  onCommit?: (color: string) => void
  showHexInput?: boolean
  swatchSize?: number
  hexInputWidth?: number
  title?: string
  onLiveDomUpdate?: (color: string) => void
}

export default function ColorPicker({
  value,
  onChange,
  onCommit,
  showHexInput = true,
  swatchSize = 20,
  hexInputWidth = 58,
  title = 'Select color',
  onLiveDomUpdate
}: ColorPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  /**
   * Viewport coordinates for the panel, which goes in a portal on
   * `document.body`. Several callers put this inside a scrolling modal or
   * settings pane, and `position: fixed` alone is not enough to get out of one:
   * any transformed ancestor becomes the containing block for it.
   */
  const [openAt, setOpenAt] = useState<{ left: number; top: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const open = openAt !== null

  // Closes on a click anywhere else, rather than behind a full-screen backdrop
  // that would sit above the caller's own controls.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (anchorRef.current?.contains(target) || panelRef.current?.contains(target)) return
      setOpenAt(null)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpenAt(null) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const isSelfUpdateRef = useRef(false)
  const [hex, setHex] = useState(value || '#3b82f6')

  // Synchronize internal state with external prop updates if not self-triggered
  useEffect(() => {
    if (isSelfUpdateRef.current) {
      isSelfUpdateRef.current = false
      return
    }
    const validHex = value && value.startsWith('#') && value.length === 7 ? value : value || '#3b82f6'
    setHex(validHex)
    if (inputRef.current) {
      inputRef.current.value = validHex
    }
  }, [value])

  const handleLiveInput = (color: string) => {
    isSelfUpdateRef.current = true
    setHex(color)
    if (onLiveDomUpdate) onLiveDomUpdate(color)
    if (onChange) onChange(color)
  }

  const handleCommit = (color: string) => {
    isSelfUpdateRef.current = true
    setHex(color)
    if (onCommit) {
      onCommit(color)
    } else if (onChange) {
      onChange(color)
    }
  }

  const validHex = hex && hex.startsWith('#') && hex.length === 7 ? hex : '#3b82f6'

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <div ref={anchorRef} style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={e => {
            if (open) { setOpenAt(null); return }
            const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
            setOpenAt({
              left: Math.min(box.left, window.innerWidth - 232),
              top: Math.min(box.bottom + 6, window.innerHeight - 232)
            })
          }}
          title={title}
          aria-label={title}
          aria-expanded={open}
          style={{
            width: `${swatchSize}px`,
            height: `${swatchSize}px`,
            padding: 0,
            border: '1px solid var(--color-surface-offset)',
            borderRadius: '4px',
            background: validHex,
            cursor: 'pointer',
            display: 'block'
          }}
        />

        {openAt && createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed', left: `${openAt.left}px`, top: `${openAt.top}px`, zIndex: 60,
              padding: 'var(--space-3)',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <ColorField value={validHex} onChange={handleLiveInput} onCommit={handleCommit} />
          </div>,
          document.body
        )}
      </div>
      {showHexInput && (
        <input
          type="text"
          value={hex}
          onChange={e => handleLiveInput(e.target.value)}
          onBlur={e => handleCommit(e.target.value)}
          placeholder="#hex"
          maxLength={7}
          style={{
            width: `${hexInputWidth}px`,
            background: 'var(--color-surface-2)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: '4px',
            color: 'var(--color-text-base)',
            fontSize: '10px',
            padding: '2px 4px',
            outline: 'none',
            fontFamily: 'monospace'
          }}
        />
      )}
    </div>
  )
}
