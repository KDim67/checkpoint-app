import React, { useCallback, useEffect, useState } from 'react'
import { LayoutGrid, Zap, FolderOpen, Power, Settings as SettingsIcon } from 'lucide-react'
import {
  DEFAULT_STARTUP_SETTINGS,
  type StartupSettings
} from '../../../shared/startupSettings'

interface Summary {
  context: string
  overdue: number
  dueToday: number
  open: number
}

/**
 * The tray popup.
 *
 * A themed window rather than a native menu, so it can carry live counts and
 * toggles and look like the rest of the app. It applies the stored theme itself:
 * this window is its own renderer instance and never runs App's startup effect,
 * so without this it would always paint with the default dark tokens.
 */
export default function TrayPanel(): React.JSX.Element {
  const [summary, setSummary] = useState<Summary>({ context: '', overdue: 0, dueToday: 0, open: 0 })
  const [startup, setStartup] = useState<StartupSettings>(DEFAULT_STARTUP_SETTINGS)

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextStartup, theme] = await Promise.all([
        window.electronAPI.tray.summary(),
        window.electronAPI.tray.getStartup(),
        window.electronAPI.db.getSetting('app_theme').catch(() => null)
      ])
      setSummary(nextSummary)
      setStartup(nextStartup)

      const resolved =
        theme === 'light' || theme === 'dark'
          ? theme
          : window.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark'
      document.documentElement.setAttribute('data-theme', resolved)
    } catch (err) {
      console.error('Failed to load the tray panel:', err)
    }
  }, [])

  // Reloaded every time the panel is shown, not just on mount: the window is
  // reused between openings, so a mount-only read would go stale immediately.
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const act = (action: string) => window.electronAPI.tray.action(action)

  const toggle = async (key: keyof StartupSettings) => {
    const next = { ...startup, [key]: !startup[key] }
    setStartup(next)
    setStartup(await window.electronAPI.tray.setStartup(next))
  }

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    width: '100%',
    padding: 'var(--space-2) var(--space-2-5)',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-base)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    textAlign: 'left'
  }

  const hoverable = {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.background = 'var(--color-surface-2)'
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      e.currentTarget.style.background = 'transparent'
    }
  }

  const Stat = ({ value, label, warn }: { value: number; label: string; warn?: boolean }) => (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{
        fontSize: 'var(--text-lg)',
        fontWeight: 'var(--weight-semibold)',
        color: warn && value > 0 ? 'var(--color-error)' : 'var(--color-secondary)'
      }}>
        {value}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--color-text-faint)' }}>{label}</div>
    </div>
  )

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-2xl)',
      overflow: 'hidden',
      fontFamily: 'var(--font-sans)'
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)',
        padding: 'var(--space-3) var(--space-3) var(--space-2)'
      }}>
        <span style={{
          fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)',
          color: 'var(--color-secondary)', letterSpacing: 'var(--tracking-wide)'
        }}>
          CHECKPOINT
        </span>
        {summary.context && (
          <span style={{
            fontSize: '10px', color: 'var(--color-text-faint)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {summary.context}
          </span>
        )}
      </div>

      <div style={{
        display: 'flex', gap: 'var(--space-2)',
        margin: '0 var(--space-3) var(--space-3)',
        padding: 'var(--space-2-5) 0',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)'
      }}>
        <Stat value={summary.overdue} label="overdue" warn />
        <Stat value={summary.dueToday} label="due today" />
        <Stat value={summary.open} label="open" />
      </div>

      <div style={{ padding: '0 var(--space-2)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <button style={row} {...hoverable} onClick={() => act('open')}>
          <LayoutGrid size={13} style={{ color: 'var(--color-text-muted)' }} />
          Open Checkpoint
        </button>
        <button style={row} {...hoverable} onClick={() => act('capture')}>
          <Zap size={13} style={{ color: 'var(--color-text-muted)' }} />
          Quick capture
        </button>
        <button style={row} {...hoverable} onClick={() => act('data-folder')}>
          <FolderOpen size={13} style={{ color: 'var(--color-text-muted)' }} />
          Open data folder
        </button>
      </div>

      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: 'var(--space-2) var(--space-3)' }} />

      <div style={{ padding: '0 var(--space-2)', display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <span style={{
          padding: '0 var(--space-2-5) var(--space-1)',
          fontSize: '9px', fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)', textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wider)'
        }}>
          <SettingsIcon size={9} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
          Startup
        </span>

        {([
          ['openAtLogin', 'Start with Windows'],
          ['startMinimised', 'Start hidden in the tray'],
          ['closeToTray', 'Close button hides to tray']
        ] as [keyof StartupSettings, string][]).map(([key, label]) => {
          // Both of these need somewhere to hide to, and would strand the window
          // if the tray icon were off.
          const disabled = !startup.showTrayIcon && key !== 'openAtLogin'
          return (
            <label
              key={key}
              style={{ ...row, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1 }}
              {...(disabled ? {} : hoverable)}
            >
              <input
                type="checkbox"
                checked={startup[key]}
                disabled={disabled}
                onChange={() => toggle(key)}
                style={{ accentColor: 'var(--color-secondary)', cursor: 'inherit' }}
              />
              {label}
            </label>
          )
        })}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ padding: '0 var(--space-2) var(--space-2)' }}>
        <button
          style={{ ...row, color: 'var(--color-error)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-error-muted)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          onClick={() => act('quit')}
        >
          <Power size={13} />
          Quit Checkpoint
        </button>
      </div>
    </div>
  )
}
