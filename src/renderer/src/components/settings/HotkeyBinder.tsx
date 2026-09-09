import React, { useState, useEffect } from 'react'
import { useToast } from '../ui/Toast'
import { useAiEnabled } from '../../lib/useAiEnabled'
import { getEnumSetting, setStringSetting } from '../../lib/settings'
import {
  PAN_BUTTONS_KEY, MENU_BUTTON_KEY, PAN_BUTTON_MODES, MENU_BUTTON_MODES,
  type PanButtons, type MenuButton
} from '../../lib/wallInput'
import { AlertTriangle, Keyboard } from 'lucide-react'
import {
  APP_SHORTCUTS,
  VIEW_SHORTCUTS,
  SCOPE_LABELS,
  loadBindings,
  saveBindings,
  defaultBindings,
  loadViewBindings,
  saveViewBindings,
  defaultViewBindings,
  comboFromEvent,
  isReservedCombo,
  shortcutClash,
  type ShortcutBindings,
  type ShortcutScope
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

/**
 * Which list a recording is for. Three now, stored separately: the OS-level
 * hotkeys, the in-app ones that work anywhere, and the per-view commands,
 * where the scope also decides what counts as a collision.
 */
type RecordingTarget = { scope: 'global' | 'app' | ShortcutScope; id: string }

const VIEW_SCOPES = [...new Set(VIEW_SHORTCUTS.map(s => s.scope))]

const PAN_CHOICES: { value: PanButtons; label: string }[] = [
  { value: 'both', label: 'Middle or right button' },
  { value: 'middle', label: 'Middle button only' },
  { value: 'right', label: 'Right button only' }
]

const MENU_CHOICES: { value: MenuButton; label: string }[] = [
  { value: 'right', label: 'Right button' },
  { value: 'middle', label: 'Middle button' },
  { value: 'none', label: 'No button' }
]

/** A labelled dropdown, for the settings that pick from a short list. */
function ChoiceRow<T extends string>({
  label, desc, value, choices, onChange
}: {
  label: string
  desc: string
  value: T
  choices: { value: T; label: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: 'var(--space-3)',
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)'
    }}>
      <div style={{ marginRight: 'var(--space-4)', flex: 1 }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)', display: 'block' }}>
          {label}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{desc}</span>
      </div>
      <select
        value={value}
        aria-label={label}
        onChange={e => onChange(e.target.value as T)}
        style={{
          background: 'var(--color-surface-2)',
          border: '1px solid var(--color-surface-offset)',
          color: 'var(--color-text-base)',
          borderRadius: '4px',
          padding: '5px 8px',
          fontSize: 'var(--text-xs)',
          minWidth: '170px',
          outline: 'none'
        }}
      >
        {choices.map(choice => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
    </div>
  )
}

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
  const aiEnabled = useAiEnabled()
  const [engineEnabled, setEngineEnabled] = useState(false)
  const [bindings, setBindings] = useState<Record<string, string>>({
    hud_toggle: 'Ctrl+Shift+Space',
    clipboard_toggle: 'Ctrl+Shift+V'
  })
  const [appBindings, setAppBindings] = useState<ShortcutBindings>(defaultBindings)
  const [viewBindings, setViewBindings] = useState<ShortcutBindings>(defaultViewBindings)
  const [panButtons, setPanButtons] = useState<PanButtons>(PAN_BUTTON_MODES[0])
  const [menuButton, setMenuButton] = useState<MenuButton>(MENU_BUTTON_MODES[0])
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
      setViewBindings(await loadViewBindings())
      setPanButtons(await getEnumSetting(PAN_BUTTONS_KEY, PAN_BUTTON_MODES, PAN_BUTTON_MODES[0]))
      setMenuButton(await getEnumSetting(MENU_BUTTON_KEY, MENU_BUTTON_MODES, MENU_BUTTON_MODES[0]))
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

    if (isReservedCombo(combo)) {
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
    } else if (recording.scope === 'app') {
      // Checked against every view as well: an in-app shortcut fires wherever
      // you are, so sharing a combo with one would double-fire.
      const clash = shortcutClash(combo, { id: recording.id, scope: 'global' }, appBindings, viewBindings)
      if (clash) {
        setCollisionWarning(`"${combo}" is already bound to "${clash}".`)
        return
      }
      const next = { ...appBindings, [recording.id]: combo }
      setAppBindings(next)
      // Applied immediately. These are in-window listeners, so unlike the
      // global hotkeys there is nothing to register with the OS.
      saveBindings(next).catch(err => console.error('Failed to save shortcuts:', err))
    } else {
      // Only its own view and the app-wide list. Another view's keys are free
      // to take: the two are never on screen together.
      const clash = shortcutClash(combo, { id: recording.id, scope: recording.scope }, appBindings, viewBindings)
      if (clash) {
        setCollisionWarning(`"${combo}" is already bound to "${clash}".`)
        return
      }
      const next = { ...viewBindings, [recording.id]: combo }
      setViewBindings(next)
      saveViewBindings(next).catch(err => console.error('Failed to save view shortcuts:', err))
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

  const handleResetViewDefaults = () => {
    const defaults = defaultViewBindings()
    setViewBindings(defaults)
    setCollisionWarning(null)
    saveViewBindings(defaults)
      .then(() => toast('View shortcuts reset to defaults'))
      .catch(err => console.error('Failed to reset view shortcuts:', err))
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

        {APP_SHORTCUTS.filter(s => s.action.kind !== 'toggleAiPanel' || aiEnabled).map(shortcut => (
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeading>View Shortcuts</SectionHeading>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'calc(-1 * var(--space-2))' }}>
          Work only while that view is open, so two of them can share a key without clashing.
          A kanban card also needs to be focused, which Tab does.
        </span>

        {VIEW_SCOPES.map(scope => (
          <div key={scope} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{
              fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-muted)'
            }}>
              {SCOPE_LABELS[scope]}
            </span>
            {VIEW_SHORTCUTS.filter(s => s.scope === scope).map(shortcut => (
              <ShortcutRow
                key={shortcut.id}
                label={shortcut.label}
                combo={viewBindings[shortcut.id]}
                isRecording={recording?.scope === scope && recording.id === shortcut.id}
                onStartRecording={() => startRecording({ scope, id: shortcut.id })}
                onKeyDown={handleKeyDown}
              />
            ))}
          </div>
        ))}

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <ActionButton onClick={handleResetViewDefaults} disabled={recording !== null} variant="secondary">
            Restore Default View Shortcuts
          </ActionButton>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <SectionHeading>Mouse</SectionHeading>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'calc(-1 * var(--space-2))' }}>
          On the Wall, where the right button both pans and opens the menu. Holding
          space and dragging with the left button always pans, whatever these say.
        </span>

        <ChoiceRow
          label="Pan the wall with"
          desc="Hold the button down and drag to move the view."
          value={panButtons}
          choices={PAN_CHOICES}
          onChange={next => {
            setPanButtons(next)
            void setStringSetting(PAN_BUTTONS_KEY, next)
          }}
        />
        <ChoiceRow
          label="Open the context menu with"
          desc="A click that does not move. If this button also pans, a drag pans instead."
          value={menuButton}
          choices={MENU_CHOICES}
          onChange={next => {
            setMenuButton(next)
            void setStringSetting(MENU_BUTTON_KEY, next)
          }}
        />
      </div>
    </div>
  )
}
