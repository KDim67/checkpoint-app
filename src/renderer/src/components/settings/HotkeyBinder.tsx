import React, { useState, useEffect } from 'react'
import { useToast } from '../ui/Toast'
import { AlertTriangle, Keyboard } from 'lucide-react'
import {
  APP_SHORTCUTS,
  loadBindings,
  saveBindings,
  defaultBindings,
  comboFromEvent,
  type ShortcutBindings
} from '../../lib/shortcuts'

type GlobalAction = 'hud_toggle' | 'clipboard_toggle'

const ACTION_LABELS: Record<GlobalAction, { label: string; desc: string; defaultKey: string }> = {
  hud_toggle: {
    label: 'Toggle Spotlight HUD overlay',
    desc: 'Summons the borderless input bar centered on screen.',
    defaultKey: 'Ctrl+Shift+Space'
  },
  clipboard_toggle: {
    label: 'Open Clipboard History feed',
    desc: 'Brings focus to the app window and navigates to the clipboard history tab.',
    defaultKey: 'Ctrl+Shift+V'
  }
}

const FORBIDDEN_SHORTCUTS = [
  'Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+S',
  'Cmd+C', 'Cmd+V', 'Cmd+X', 'Cmd+A', 'Cmd+Z', 'Cmd+Y', 'Cmd+S',
  'Alt+F4', 'Ctrl+Alt+Delete'
]

/** Which list a recording is for, the two are bound and stored separately. */
type RecordingTarget = { scope: 'global' | 'app'; id: string }

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>
      {children}
    </h4>
  )
}

function ShortcutRow({
  label,
  desc,
  combo,
  isRecording,
  onStartRecording,
  onKeyDown
}: {
  label: string
  desc?: string
  combo: string
  isRecording: boolean
  onStartRecording: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 'var(--space-3)',
        background: 'var(--color-surface-1)',
        border: `1px solid ${isRecording ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 100ms ease'
      }}
    >
      <div style={{ marginRight: 'var(--space-4)', flex: 1 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)', display: 'block' }}>
          {label}
        </span>
        {desc && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {desc}
          </span>
        )}
      </div>

      <div className="row">
        {isRecording ? (
          <input
            type="text"
            placeholder="Press key combination…"
            aria-label={`Recording shortcut for ${label}`}
            onKeyDown={onKeyDown}
            autoFocus
            style={{
              background: 'var(--color-surface-offset)',
              border: '1px solid var(--color-secondary)',
              color: 'var(--color-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              borderRadius: '4px',
              padding: '4px 8px',
              width: '160px',
              outline: 'none',
              textAlign: 'center'
            }}
          />
        ) : (
          <button
            onClick={onStartRecording}
            aria-label={`Change shortcut for ${label}. Currently ${combo || 'unassigned'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              background: 'var(--color-surface-2)',
              border: '1px solid var(--color-surface-offset)',
              color: combo ? 'var(--color-text-base)' : 'var(--color-text-faint)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              borderRadius: '4px',
              padding: '4px 10px',
              cursor: 'pointer',
              minWidth: '110px',
              justifyContent: 'center',
              transition: 'all 100ms ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-primary)'
              e.currentTarget.style.color = 'var(--color-primary)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
              e.currentTarget.style.color = combo ? 'var(--color-text-base)' : 'var(--color-text-faint)'
            }}
          >
            <Keyboard size={12} />
            {combo || 'Unassigned'}
          </button>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  children,
  onClick,
  disabled,
  variant
}: {
  children: React.ReactNode
  onClick: () => void
  disabled: boolean
  variant: 'primary' | 'secondary'
}) {
  const base = variant === 'primary' ? 'var(--color-primary)' : 'var(--color-surface-offset)'
  const hover = variant === 'primary' ? 'var(--color-primary-hover)' : 'var(--color-surface-elevated)'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: 'var(--space-2) var(--space-4)',
        background: base,
        border: `1px solid ${base}`,
        color: variant === 'primary' ? '#ffffff' : 'var(--color-text-base)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 100ms ease',
        opacity: disabled ? 0.5 : 1
      }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = hover }}
      onMouseLeave={e => { if (!disabled) e.currentTarget.style.background = base }}
    >
      {children}
    </button>
  )
}

export default function HotkeyBinder() {
  const { toast } = useToast()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [bindings, setBindings] = useState<Record<string, string>>({
    hud_toggle: 'Ctrl+Shift+Space',
    clipboard_toggle: 'Ctrl+Shift+V'
  })
  const [appBindings, setAppBindings] = useState<ShortcutBindings>(defaultBindings)
  const [recording, setRecording] = useState<RecordingTarget | null>(null)
  const [collisionWarning, setCollisionWarning] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const enabled = await window.electronAPI.customizer.getEngineState()
        setEngineEnabled(enabled)

        const stored = await window.electronAPI.customizer.getShortcuts()
        if (stored && Object.keys(stored).length > 0) {
          setBindings(prev => ({ ...prev, ...stored }))
        }
      } catch (err) {
        console.error('Failed to load shortcuts:', err)
      }
      setAppBindings(await loadBindings())
    }
    load().catch(err => console.error('Failed to load shortcuts:', err))
  }, [])

  const startRecording = (target: RecordingTarget) => {
    setRecording(target)
    setCollisionWarning(null)
    toast('Recording... Press your keyboard combination')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return

    e.preventDefault()
    e.stopPropagation()

    // Escape abandons the recording rather than binding itself.
    if (e.key === 'Escape') {
      setRecording(null)
      setCollisionWarning(null)
      return
    }

    const combo = comboFromEvent(e)
    if (!combo) return

    if (FORBIDDEN_SHORTCUTS.includes(combo)) {
      setCollisionWarning(`"${combo}" is a reserved system shortcut and cannot be bound.`)
      return
    }

    if (recording.scope === 'global') {
      const otherAction: GlobalAction = recording.id === 'hud_toggle' ? 'clipboard_toggle' : 'hud_toggle'
      if (bindings[otherAction] === combo) {
        setCollisionWarning(`"${combo}" is already bound to another action.`)
        return
      }
      setBindings(prev => ({ ...prev, [recording.id]: combo }))
    } else {
      const clash = APP_SHORTCUTS.find(s => s.id !== recording.id && appBindings[s.id] === combo)
      if (clash) {
        setCollisionWarning(`"${combo}" is already bound to "${clash.label}".`)
        return
      }
      const next = { ...appBindings, [recording.id]: combo }
      setAppBindings(next)
      // Applied immediately, these are in-window listeners, so unlike the
      // global hotkeys there is nothing to register with the OS.
      saveBindings(next).catch(err => console.error('Failed to save shortcuts:', err))
    }

    setRecording(null)
    setCollisionWarning(null)
    toast(`Captured shortcut: ${combo}`)
  }

  const handleSave = async () => {
    try {
      await window.electronAPI.customizer.registerShortcuts(bindings)
      toast('Global shortcuts registered successfully')
    } catch (err) {
      console.error(err)
      toast('Failed to register custom shortcuts')
    }
  }

  const handleResetDefaults = async () => {
    const defaults = {
      hud_toggle: ACTION_LABELS.hud_toggle.defaultKey,
      clipboard_toggle: ACTION_LABELS.clipboard_toggle.defaultKey
    }
    setBindings(defaults)
    setCollisionWarning(null)
    try {
      await window.electronAPI.customizer.registerShortcuts(defaults)
      toast('Shortcut keys reset to defaults')
    } catch (err) {
      console.error(err)
    }
  }

  const handleResetAppDefaults = () => {
    const defaults = defaultBindings()
    setAppBindings(defaults)
    setCollisionWarning(null)
    saveBindings(defaults)
      .then(() => toast('In-app shortcuts reset to defaults'))
      .catch(err => console.error('Failed to reset shortcuts:', err))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {!engineEnabled && (
        <div style={{
          background: 'rgba(249, 115, 22, 0.1)',
          border: '1px solid var(--color-warning)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)'
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>
            Customization Engine is disabled. Enable it in the <strong>Theme Builder</strong> settings tab first to register customized global shortcut triggers. In-app shortcuts below work regardless.
          </div>
        </div>
      )}

      {collisionWarning && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid var(--color-error)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2) var(--space-3)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)'
        }}>
          <AlertTriangle size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
            {collisionWarning}
          </span>
        </div>
      )}

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        opacity: engineEnabled ? 1 : 0.6,
        pointerEvents: engineEnabled ? 'auto' : 'none',
        transition: 'opacity 200ms ease'
      }}>
        <SectionHeading>Global Shortcuts</SectionHeading>

        {(Object.keys(ACTION_LABELS) as GlobalAction[]).map(action => (
          <ShortcutRow
            key={action}
            label={ACTION_LABELS[action].label}
            desc={ACTION_LABELS[action].desc}
            combo={bindings[action]}
            isRecording={recording?.scope === 'global' && recording.id === action}
            onStartRecording={() => startRecording({ scope: 'global', id: action })}
            onKeyDown={handleKeyDown}
          />
        ))}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <ActionButton onClick={handleSave} disabled={recording !== null} variant="primary">
            Apply Bindings
          </ActionButton>
          <ActionButton onClick={handleResetDefaults} disabled={recording !== null} variant="secondary">
            Restore Default Hotkeys
          </ActionButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeading>In-App Shortcuts</SectionHeading>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'calc(-1 * var(--space-2))' }}>
          Fire only while the Checkpoint window has focus, and are ignored while typing. Changes apply immediately.
        </span>

        {APP_SHORTCUTS.map(shortcut => (
          <ShortcutRow
            key={shortcut.id}
            label={shortcut.label}
            combo={appBindings[shortcut.id]}
            isRecording={recording?.scope === 'app' && recording.id === shortcut.id}
            onStartRecording={() => startRecording({ scope: 'app', id: shortcut.id })}
            onKeyDown={handleKeyDown}
          />
        ))}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <ActionButton onClick={handleResetAppDefaults} disabled={recording !== null} variant="secondary">
            Restore Default Shortcuts
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
