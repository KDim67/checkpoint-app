import React, { useEffect, useState } from 'react'
import { ToggleSwitch, RowBetween } from './SettingsSection'
import { useToast } from '../ui/Toast'
import {
  DEFAULT_STARTUP_SETTINGS,
  STARTUP_OPTIONS,
  type StartupSettings as Settings
} from '../../../../shared/startupSettings'

/**
 * The same switches the tray panel carries, in the settings page.
 *
 * Both read and write through the same IPC and share STARTUP_OPTIONS, so there
 * is one description of what each switch does and no way for the two surfaces to
 * disagree about the current state.
 */
export default function StartupSettings(): React.JSX.Element {
  const { toast } = useToast()
  const [settings, setSettings] = useState<Settings>(DEFAULT_STARTUP_SETTINGS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    window.electronAPI.tray
      .getStartup()
      .then(s => { setSettings(s); setLoaded(true) })
      .catch(err => { console.error('Failed to load startup settings:', err); setLoaded(true) })

    // These switches also live in the tray panel; without this the two disagree
    // until one of them is reloaded.
    return window.electronAPI.tray.onStartupChanged(setSettings)
  }, [])

  const toggle = async (key: keyof Settings, value: boolean) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    try {
      // Main reconciles. Turning the tray icon off forces the dependent options
      // off, so its answer replaces the optimistic one rather than sitting
      // beside it.
      setSettings(await window.electronAPI.tray.setStartup(next))
    } catch (err) {
      console.error(err)
      toast('Could not save startup settings')
    }
  }

  if (!loaded) {
    return <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {STARTUP_OPTIONS.map(option => {
        const disabled = option.needsTray && !settings.showTrayIcon
        return (
          <RowBetween key={option.key}>
            <div style={{ opacity: disabled ? 0.5 : 1 }}>
              <div style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                color: 'var(--color-text-base)'
              }}>
                {option.label}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
                {option.hint}
              </div>
            </div>
            <ToggleSwitch
              checked={settings[option.key]}
              onChange={value => toggle(option.key, value)}
              disabled={disabled}
              label={option.label}
            />
          </RowBetween>
        )
      })}
    </div>
  )
}
