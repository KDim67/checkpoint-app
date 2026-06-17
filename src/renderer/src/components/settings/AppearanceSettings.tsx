import React, { useState, useEffect } from 'react'
import { FolderOpen } from 'lucide-react'
import { FieldRow, ToggleSwitch, Divider, RowBetween } from './SettingsSection'

type FontSize = 'small' | 'medium' | 'large'

const FONT_SCALES: Record<FontSize, string> = {
  small:  '0.9',
  medium: '1.0',
  large:  '1.125'
}

function applyFontSize(size: FontSize): void {
  document.documentElement.style.setProperty('--font-size-scale', FONT_SCALES[size])
  // Scale all text tokens proportionally
  const scale = parseFloat(FONT_SCALES[size])
  const tokens: Record<string, string> = {
    '--text-2xs': `${0.625 * scale}rem`,
    '--text-xs':  `${0.75  * scale}rem`,
    '--text-sm':  `${0.875 * scale}rem`,
    '--text-base':`${1.0   * scale}rem`,
    '--text-lg':  `${1.125 * scale}rem`,
    '--text-xl':  `${1.25  * scale}rem`,
    '--text-2xl': `${1.5   * scale}rem`
  }
  Object.entries(tokens).forEach(([k, v]) =>
    document.documentElement.style.setProperty(k, v)
  )
}

function applyCompactMode(enabled: boolean): void {
  if (enabled) {
    document.documentElement.setAttribute('data-compact', 'true')
  } else {
    document.documentElement.removeAttribute('data-compact')
  }
}

export default function AppearanceSettings() {
  const [fontSize, setFontSize] = useState<FontSize>('medium')
  const [compactMode, setCompactMode] = useState(false)
  const [themePath, setThemePath] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const fs = await window.electronAPI.db.getSetting('appearance_font_size')
        const cm = await window.electronAPI.db.getSetting('appearance_compact')
        if (fs) { setFontSize(fs as FontSize); applyFontSize(fs as FontSize) }
        if (cm) { setCompactMode(cm === 'true'); applyCompactMode(cm === 'true') }

        const home = await window.electronAPI.app.getDataPath()
        // Theme file is at ~/.config/checkpoint/theme.css
        const platform = window.electronAPI.app.platform
        const configDir = platform === 'win32'
          ? home.replace(/\\AppData\\Roaming.*/, '') + '\\.config\\checkpoint'
          : `${home}/.config/checkpoint`
        setThemePath(`${configDir}\\theme.css`.replace(/\\\\/g, '\\'))
      } catch (err) {
        console.error('Failed to load appearance settings:', err)
      }
    }
    load()
  }, [])

  const handleFontSize = async (size: FontSize) => {
    setFontSize(size)
    applyFontSize(size)
    await window.electronAPI.db.setSetting('appearance_font_size', size)
  }

  const handleCompact = async (enabled: boolean) => {
    setCompactMode(enabled)
    applyCompactMode(enabled)
    await window.electronAPI.db.setSetting('appearance_compact', String(enabled))
  }

  const FONT_OPTIONS: { value: FontSize; label: string; desc: string }[] = [
    { value: 'small',  label: 'Small',  desc: '90%'   },
    { value: 'medium', label: 'Medium', desc: '100%'  },
    { value: 'large',  label: 'Large',  desc: '112%'  }
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {/* Font size */}
      <FieldRow label="Font Size" hint="Scales all text proportionally across the entire app.">
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {FONT_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleFontSize(opt.value)}
              style={{
                flex: 1,
                padding: 'var(--space-2) var(--space-3)',
                background: fontSize === opt.value
                  ? 'var(--color-secondary-muted)'
                  : 'var(--color-surface-2)',
                border: `1px solid ${fontSize === opt.value ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                borderRadius: 'var(--radius-md)',
                color: fontSize === opt.value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                transition: 'all 100ms ease'
              }}
            >
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)' }}>
                {opt.label}
              </span>
              <span style={{ fontSize: '10px', opacity: 0.6 }}>{opt.desc}</span>
            </button>
          ))}
        </div>
      </FieldRow>

      <Divider />

      {/* Compact mode */}
      <RowBetween>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Compact Mode
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            Reduces card padding and row heights for denser information density.
          </div>
        </div>
        <ToggleSwitch checked={compactMode} onChange={handleCompact} />
      </RowBetween>

      <Divider />

      {/* Theme file path */}
      <FieldRow
        label="Custom Theme File"
        hint="Drop a theme.css here to override CSS tokens. Changes are hot-reloaded instantly."
      >
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)'
        }}>
          <code style={{
            flex: 1,
            fontSize: '11px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}>
            {themePath || 'Loading…'}
          </code>
          <button
            className="btn-icon"
            title="Open folder in Explorer"
            onClick={() => {
              // Open the parent directory of the theme file
              const dir = themePath.replace(/[/\\][^/\\]+$/, '')
              window.electronAPI.app.openExternal(`file://${dir}`)
            }}
            style={{ width: '28px', height: '28px', flexShrink: 0 }}
          >
            <FolderOpen size={13} />
          </button>
        </div>
      </FieldRow>
    </div>
  )
}
