import React, { useState, useEffect, useRef } from 'react'

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
      <input
        ref={inputRef}
        type="color"
        defaultValue={validHex}
        onInput={e => handleLiveInput((e.target as HTMLInputElement).value)}
        onBlur={e => handleCommit((e.target as HTMLInputElement).value)}
        style={{
          width: `${swatchSize}px`,
          height: `${swatchSize}px`,
          padding: 0,
          border: '1px solid var(--color-surface-offset)',
          borderRadius: '4px',
          background: 'transparent',
          cursor: 'pointer',
          flexShrink: 0
        }}
        title={title}
      />
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
