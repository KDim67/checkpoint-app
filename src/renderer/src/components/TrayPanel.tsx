import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LayoutGrid, Zap, Power } from 'lucide-react'
import { ToggleSwitch } from './settings/SettingsSection'
import { applyStoredTheme, watchTheme } from '../lib/themeBoot'
import {
  DEFAULT_STARTUP_SETTINGS,
  STARTUP_OPTIONS,
  type StartupSettings
} from '../../../shared/startupSettings'

interface Summary {
  context: string
  overdue: number
  dueToday: number
  open: number
}

// The tray panel omits "Show tray icon": switching it off from here would
// destroy the window the switch is drawn in. It lives in Settings instead.
const TRAY_PANEL_OPTIONS = STARTUP_OPTIONS.filter(o => o.key !== 'showTrayIcon')

/**
 * The tray popup.
 *
 * A themed window rather than a native menu, so it can carry live counts and
 * real controls. It measures itself and asks main to resize: the content grows
 * with the user's font-size setting, and a fixed height clipped the Quit button
 * at anything above the default.
 */
export default function TrayPanel(): React.JSX.Element {
  const [summary, setSummary] = useState<Summary>({ context: '', overdue: 0, dueToday: 0, open: 0 })
  const [startup, setStartup] = useState<StartupSettings>(DEFAULT_STARTUP_SETTINGS)
  const [ready, setReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextStartup] = await Promise.all([
        window.electronAPI.tray.summary(),
        window.electronAPI.tray.getStartup()
      ])
      setSummary(nextSummary)
      setStartup(nextStartup)
    } catch (err) {
      console.error('Failed to load the tray panel:', err)
    } finally {
      setReady(true)
    }
  }, [])

  useEffect(() => {
    applyStoredTheme()
    const stopWatching = watchTheme()
    load()

    // The window is reused between openings, so a mount-only read would be stale
    // the second time it is shown.
    window.addEventListener('focus', load)
    // Counts move while the panel is open. A card completed in the main window,
    // or an agent writing over MCP, and the switches are also shown in Settings.
    const stopData = window.electronAPI.mcp.onDataChanged(load)
    const stopStartup = window.electronAPI.tray.onStartupChanged(setStartup)

    return () => {
      stopWatching()
      stopData()
      stopStartup()
      window.removeEventListener('focus', load)
    }
  }, [load])

  // Measured after paint so the height accounts for the real fonts.
  useLayoutEffect(() => {
    if (!ready || !rootRef.current) return
    const height = Math.ceil(rootRef.current.getBoundingClientRect().height)
    window.electronAPI.tray.resize(height).catch(() => {})
  }, [ready, startup, summary])

  const act = (action: string): void => { window.electronAPI.tray.action(action) }

  const toggle = async (key: keyof StartupSettings): Promise<void> => {
    const next = { ...startup, [key]: !startup[key] }
    setStartup(next)
    // Main reconciles (turning the tray icon off forces the other two off), so
    // its answer is authoritative, not the optimistic value above.
    setStartup(await window.electronAPI.tray.setStartup(next))
  }

  const actionRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2-5)',
    width: '100%',
    padding: 'var(--space-2) var(--space-2-5)',
    background: 'transparent',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-base)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 100ms ease'
  }

  const hover = (enter: boolean) => (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.background = enter ? 'var(--color-surface-2)' : 'transparent'
  }

  const Stat = ({ value, label, warn }: { value: number; label: string; warn?: boolean }) => {
    const alert = warn && value > 0
    return (
      <div style={{ flex: 1, textAlign: 'center', padding: 'var(--space-2) 0' }}>
        <div style={{
          fontSize: 'var(--text-lg)',
          fontWeight: 'var(--weight-semibold)',
          lineHeight: 1.1,
          color: alert ? 'var(--color-error)' : value > 0 ? 'var(--color-secondary)' : 'var(--color-text-faint)'
        }}>
          {value}
        </div>
        <div style={{
          fontSize: '10px',
          marginTop: '3px',
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)'
        }}>
          {label}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      style={{
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-2xl)',
        overflow: 'hidden',
        fontFamily: 'var(--font-sans)'
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-3-5) var(--space-2)'
      }}>
        <span style={{
          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)',
          color: 'var(--color-secondary)', letterSpacing: 'var(--tracking-wider)'
        }}>
          CHECKPOINT
        </span>
        {summary.context && (
          <span style={{
            fontSize: '10px', color: 'var(--color-text-faint)', minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>
            {summary.context}
          </span>
        )}
      </div>

      <div style={{
        display: 'flex',
        margin: '0 var(--space-3) var(--space-2)',
        background: 'var(--color-surface-2)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-md)'
      }}>
        <Stat value={summary.overdue} label="overdue" warn />
        <div style={{ width: '1px', background: 'var(--color-surface-offset)' }} />
        <Stat value={summary.dueToday} label="today" />
        <div style={{ width: '1px', background: 'var(--color-surface-offset)' }} />
        <Stat value={summary.open} label="open" />
      </div>

      <div style={{ padding: '0 var(--space-2)', display: 'flex', flexDirection: 'column' }}>
        <button style={actionRow} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={() => act('open')}>
          <LayoutGrid size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          Open Checkpoint
        </button>
        <button style={actionRow} onMouseEnter={hover(true)} onMouseLeave={hover(false)} onClick={() => act('capture')}>
          <Zap size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
          Quick capture
        </button>
      </div>

      <div style={{ height: '1px', background: 'var(--color-surface-offset)', margin: 'var(--space-2) var(--space-3)' }} />

      <div style={{ padding: '0 var(--space-3-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{
          fontSize: '9px', fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)', textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wider)'
        }}>
          Startup
        </span>

        {TRAY_PANEL_OPTIONS.map(({ key, label, hint, needsTray }) => {
          // Without a tray icon these would strand the window, so main refuses
          // them and the control says so rather than appearing to work.
          const disabled = needsTray && !startup.showTrayIcon
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 'var(--space-3)', opacity: disabled ? 0.45 : 1
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)' }}>{label}</div>
                <div style={{ fontSize: '10px', color: 'var(--color-text-faint)', marginTop: '1px' }}>{hint}</div>
              </div>
              <ToggleSwitch
                checked={startup[key]}
                onChange={() => toggle(key)}
                disabled={disabled}
                label={label}
              />
            </div>
          )
        })}
      </div>

      <div style={{ padding: 'var(--space-2-5) var(--space-2) var(--space-2)' }}>
        <button
          style={{ ...actionRow, color: 'var(--color-error)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-error-muted)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
          onClick={() => act('quit')}
        >
          <Power size={14} style={{ flexShrink: 0 }} />
          Quit Checkpoint
        </button>
      </div>
    </div>
  )
}
