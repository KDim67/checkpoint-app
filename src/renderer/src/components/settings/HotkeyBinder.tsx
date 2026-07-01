import React, { useState, useEffect } from 'react'
import { useToast } from '../ui/Toast'
import { AlertTriangle, Keyboard } from 'lucide-react'

type ShortcutAction = 'hud_toggle' | 'clipboard_toggle'

const ACTION_LABELS: Record<ShortcutAction, { label: string; desc: string; defaultKey: string }> = {
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

export default function HotkeyBinder() {
  const { toast } = useToast()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [bindings, setBindings] = useState<Record<string, string>>({
    hud_toggle: 'Ctrl+Shift+Space',
    clipboard_toggle: 'Ctrl+Shift+V'
  })
  const [recording, setRecording] = useState<ShortcutAction | null>(null)
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
    }
    load()
  }, [])

  const startRecording = (action: ShortcutAction) => {
    setRecording(action)
    setCollisionWarning(null)
    toast('Recording... Press your keyboard combination')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return

    e.preventDefault()
    e.stopPropagation()

    // Ignore pure modifier presses
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
      return
    }

    const modifiers: string[] = []
    if (e.ctrlKey) modifiers.push('Ctrl')
    if (e.altKey) modifiers.push('Alt')
    if (e.shiftKey) modifiers.push('Shift')
    if (e.metaKey) modifiers.push('Cmd')

    let key = e.key
    if (key === ' ') {
      key = 'Space'
    } else if (key.length === 1) {
      key = key.toUpperCase()
    } else if (key.startsWith('Arrow')) {
      key = key.replace('Arrow', '')
    }

    const combo = [...modifiers, key].join('+')

    // Collision checks
    if (FORBIDDEN_SHORTCUTS.includes(combo)) {
      setCollisionWarning(`"${combo}" is a reserved system shortcut and cannot be bound.`)
      return
    }

    // Check if duplicate of other action
    const otherAction = recording === 'hud_toggle' ? 'clipboard_toggle' : 'hud_toggle'
    if (bindings[otherAction] === combo) {
      setCollisionWarning(`"${combo}" is already bound to another action.`)
      return
    }

    // Normal successful capture
    setBindings(prev => ({ ...prev, [recording]: combo }))
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
      hud_toggle: 'Ctrl+Shift+Space',
      clipboard_toggle: 'Ctrl+Shift+V'
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
            Customization Engine is disabled. Enable it in the <strong>Theme Builder</strong> settings tab first to register customized global shortcut triggers.
          </div>
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
        <h4 style={{ margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-wider)' }}>
          Shortcut Bindings
        </h4>

        {(Object.keys(ACTION_LABELS) as ShortcutAction[]).map(action => {
          const info = ACTION_LABELS[action]
          const isRecording = recording === action
          return (
            <div
              key={action}
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
                  {info.label}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {info.desc}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                {isRecording ? (
                  <input
                    type="text"
                    placeholder="Press key combination…"
                    onKeyDown={handleKeyDown}
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
                    onClick={() => startRecording(action)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-1)',
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-surface-offset)',
                      color: 'var(--color-text-base)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      borderRadius: '4px',
                      padding: '4px 10px',
                      cursor: 'pointer',
                      transition: 'all 100ms ease'
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = 'var(--color-primary)'
                      e.currentTarget.style.color = 'var(--color-primary)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = 'var(--color-surface-offset)'
                      e.currentTarget.style.color = 'var(--color-text-base)'
                    }}
                  >
                    <Keyboard size={12} />
                    {bindings[action]}
                  </button>
                )}
              </div>
            </div>
          )
        })}

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

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <button
            onClick={handleSave}
            disabled={recording !== null}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-primary)',
              border: '1px solid var(--color-primary)',
              color: '#ffffff',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: recording !== null ? 'default' : 'pointer',
              transition: 'all 100ms ease',
              opacity: recording !== null ? 0.5 : 1
            }}
            onMouseEnter={e => { if (recording === null) e.currentTarget.style.background = 'var(--color-primary-hover)' }}
            onMouseLeave={e => { if (recording === null) e.currentTarget.style.background = 'var(--color-primary)' }}
          >
            Apply Bindings
          </button>
          <button
            onClick={handleResetDefaults}
            disabled={recording !== null}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--color-surface-offset)',
              border: '1px solid var(--color-surface-offset)',
              color: 'var(--color-text-base)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              fontWeight: 'var(--weight-semibold)',
              cursor: recording !== null ? 'default' : 'pointer',
              transition: 'all 100ms ease',
              opacity: recording !== null ? 0.5 : 1
            }}
            onMouseEnter={e => { if (recording === null) e.currentTarget.style.background = 'var(--color-surface-elevated)' }}
            onMouseLeave={e => { if (recording === null) e.currentTarget.style.background = 'var(--color-surface-offset)' }}
          >
            Restore Default Hotkeys
          </button>
        </div>
      </div>
    </div>
  )
}
