import { useState, useEffect } from 'react'
import { Moon, Sun, MonitorCog } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { FieldRow } from './SettingsSection'
import { getStringSetting, setStringSetting } from '../../lib/settings'
import * as customizerApi from '../../data/customizer'
import { injectCustomCss } from '../../lib/themeBoot'
import { useToast, useFailureReport } from '../ui/Toast'

// dark / light / system
export default function ThemeModeSettings() {
  const report = useFailureReport()
  const [theme, setTheme] = useState<'dark' | 'light' | 'system'>('dark')
  const { toast } = useToast()

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
    try {
      // a custom palette would override the mode just picked, so it steps aside and says so
      const wasCustom = await customizerApi.getEngineState().catch(() => false)
      await customizerApi.toggleEngine(false)
      // clears the style element, drops data-theme-custom and announces it
      injectCustomCss('')
      window.dispatchEvent(new CustomEvent('customizer-engine-changed', { detail: { enabled: false } }))
      if (wasCustom) {
        toast('Your custom theme is switched off so this mode shows. Turn it back on in the Theme Customizer.')
      }
    } catch (err) {
      report('switch off the custom theme', err)
    }
  }

  // icons not emoji, the OS font ignores the theme
  const THEME_OPTIONS: { value: typeof theme; Icon: LucideIcon; label: string; desc: string }[] = [
    { value: 'dark',   Icon: Moon,    label: 'Dark',   desc: 'Easy on the eyes' },
    { value: 'light',  Icon: Sun,     label: 'Light',  desc: 'High contrast'    },
    { value: 'system', Icon: MonitorCog, label: 'System', desc: 'Follows OS'    }
  ]

  return (
    <FieldRow label="Interface Theme" hint="Applied instantly and restored on the next launch. The titlebar toggle uses the same setting.">
      <div className="flex-gap">
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
            <span className="text-micro-dim">{opt.desc}</span>
          </button>
        ))}
      </div>
    </FieldRow>
  )
}
