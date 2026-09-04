import React, { useState, useEffect, useRef } from 'react'
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
  const [open, setOpen] = useState(false)

  // Closes on a click anywhere else. The panel is absolutely positioned inside
  // whatever opened it, so a full-screen backdrop would sit above that caller's
  // own controls.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (!anchorRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(false) }
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
          onClick={() => setOpen(o => !o)}
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

        {open && (
          <div
            style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 60,
              padding: 'var(--space-3)',
              background: 'var(--color-surface-elevated)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)'
            }}
          >
            <ColorField value={validHex} onChange={handleLiveInput} onCommit={handleCommit} />
          </div>
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
