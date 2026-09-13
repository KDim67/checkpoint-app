import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LayoutGrid, Zap, Power } from 'lucide-react'
import { ToggleSwitch } from './settings/SettingsSection'
import { applyStoredTheme, watchTheme } from '../lib/themeBoot'
import {
  DEFAULT_STARTUP_SETTINGS,
  STARTUP_OPTIONS,
  type StartupSettings
} from '../../../shared/startupSettings'
import * as trayApi from '../data/tray'
import * as mcpApi from '../data/mcp'

interface Summary {
  context: string
  overdue: number
  dueToday: number
  open: number
}

// no "Show tray icon" here, turning it off would destroy this window
const TRAY_PANEL_OPTIONS = STARTUP_OPTIONS.filter(o => o.key !== 'showTrayIcon')

/** themed window, not a native menu; measures itself since font size grows it and a fixed height clipped Quit */
export default function TrayPanel(): React.JSX.Element {
  const [summary, setSummary] = useState<Summary>({ context: '', overdue: 0, dueToday: 0, open: 0 })
  const [startup, setStartup] = useState<StartupSettings>(DEFAULT_STARTUP_SETTINGS)
  const [ready, setReady] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const [nextSummary, nextStartup] = await Promise.all([
        trayApi.summary(),
        trayApi.getStartup()
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

    // the window is reused, a mount-only read goes stale
    window.addEventListener('focus', load)
    // counts move while open: main window edits, MCP writes, Settings switches
    const stopData = mcpApi.onDataChanged(load)
    const stopStartup = trayApi.onStartupChanged(setStartup)

    return () => {
      stopWatching()
      stopData()
      stopStartup()
      window.removeEventListener('focus', load)
    }
  }, [load])

  // after paint so the real fonts count
  useLayoutEffect(() => {
    if (!ready || !rootRef.current) return
    const height = Math.ceil(rootRef.current.getBoundingClientRect().height)
    trayApi.resize(height).catch(() => {})
  }, [ready, startup, summary])

  const act = (action: string): void => { trayApi.action(action) }

  const toggle = async (key: keyof StartupSettings): Promise<void> => {
    const next = { ...startup, [key]: !startup[key] }
    setStartup(next)
    // main reconciles (no tray icon forces the others off), trust its answer
    setStartup(await trayApi.setStartup(next))
  }

  const actionRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2-5)',
    width: '100%',
    padding: 'var(--space-2) var(--space-2-5)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-base)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'background 100ms ease'
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
        <button className="bg-clear hover-bg-surface-2" style={actionRow} onClick={() => act('open')}>
          <LayoutGrid size={14} className="icon-muted" />
          Open Checkpoint
        </button>
        <button className="bg-clear hover-bg-surface-2" style={actionRow} onClick={() => act('capture')}>
          <Zap size={14} className="icon-muted" />
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
          // these would strand the window without a tray icon, main refuses them
          const disabled = needsTray && !startup.showTrayIcon
          return (
            <div
              key={key}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 'var(--space-3)', opacity: disabled ? 0.45 : 1
              }}
            >
              <div className="min-w-0">
                <div className="text-xs-base">{label}</div>
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
          className="bg-clear hover-bg-error-muted"
          style={{ ...actionRow, color: 'var(--color-error)' }}
          onClick={() => act('quit')}
        >
          <Power size={14} className="no-shrink" />
          Quit Checkpoint
        </button>
      </div>
    </div>
  )
}
