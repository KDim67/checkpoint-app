import { useState, useEffect } from 'react'
import { Moon, Sun, MonitorCog } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FieldRow } from './SettingsSection'
import { getStringSetting, setStringSetting } from '../../lib/settings'

// Theme mode (dark / light / system). Rendered in Appearance & Theme
export default function ThemeModeSettings() {
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')

  useEffect(() => {
    const load = async () => {
      setTheme(await getStringSetting('app_theme', 'dark') as typeof theme)
    }
    load()
  }, [])

  const applyTheme = (t: typeof theme) => {
    if (t === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      document.documentElement.setAttribute('data-theme', t)
    }
  }

  const handleTheme = async (t: typeof theme) => {
    setTheme(t)
    applyTheme(t)
    await setStringSetting('app_theme', t)
  }

  // Icons rather than emoji: emoji are rendered by the OS font, so they ignore
  // the theme entirely and shift shape between Windows versions.
  const THEME_OPTIONS: { value: typeof theme; Icon: LucideIcon; label: string; desc: string }[] = [
    { value: 'dark',   Icon: Moon,    label: 'Dark',   desc: 'Easy on the eyes' },
    { value: 'light',  Icon: Sun,     label: 'Light',  desc: 'High contrast'    },
    { value: 'system', Icon: MonitorCog, label: 'System', desc: 'Follows OS'    }
  ]

  return (
    <FieldRow label="Interface Theme" hint="Applied instantly and restored on the next launch. The titlebar toggle uses the same setting.">
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        {THEME_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => handleTheme(opt.value)}
            style={{
              flex: 1,
              padding: 'var(--space-2) var(--space-3)',
              background: theme === opt.value ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
              border: `1px solid ${theme === opt.value ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
              borderRadius: 'var(--radius-md)',
              color: theme === opt.value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2px',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-medium)',
              transition: 'all 100ms ease'
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1-5)' }}>
              <opt.Icon size={14} />
              {opt.label}
            </span>
            <span style={{ fontSize: '10px', opacity: 0.6 }}>{opt.desc}</span>
          </button>
        ))}
      </div>
    </FieldRow>
  )
}
