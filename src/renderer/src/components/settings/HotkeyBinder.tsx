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
import * as customizerApi from '../../data/customizer'

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

/** global, app-wide and per-view lists; the scope decides what collides */
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
      <div className="flex-1-mr">
        <span className="field-label">
          {label}
        </span>
        <span className="text-hint">{desc}</span>
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
    <h4 className="heading-caps">
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
      <div className="flex-1-mr">
        <span className="field-label">
          {label}
        </span>
        {desc && (
          <span className="text-hint">
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
            className={`hotkey-binder-shortcut-trigger border-offset ${combo ? 'text-base' : 'text-faint'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              background: 'var(--color-surface-2)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              borderRadius: '4px',
              padding: '4px 10px',
              cursor: 'pointer',
              minWidth: '110px',
              justifyContent: 'center',
              transition: 'all 100ms ease'
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
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={variant === 'primary' ? 'hotkey-binder-action-primary' : 'hotkey-binder-action-secondary'}
      style={{
        padding: 'var(--space-2) var(--space-4)',
        border: `1px solid ${base}`,
        color: variant === 'primary' ? '#ffffff' : 'var(--color-text-base)',
        borderRadius: 'var(--radius-md)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'all 100ms ease',
        opacity: disabled ? 0.5 : 1
      }}
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
        const enabled = await customizerApi.getEngineState()
        setEngineEnabled(enabled)

        const stored = await customizerApi.getShortcuts()
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

    // Escape cancels instead of binding
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
      // in-app shortcuts fire everywhere, so check every view
      const clash = shortcutClash(combo, { id: recording.id, scope: 'global' }, appBindings, viewBindings)
      if (clash) {
        setCollisionWarning(`"${combo}" is already bound to "${clash}".`)
        return
      }
      const next = { ...appBindings, [recording.id]: combo }
      setAppBindings(next)
      // in-window listeners, nothing to register with the OS
      saveBindings(next).catch(err => console.error('Failed to save shortcuts:', err))
    } else {
      // another view's keys are free, never on screen together
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
      await customizerApi.registerShortcuts(bindings)
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
      await customizerApi.registerShortcuts(defaults)
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
    <div className="col-xl">
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
          <AlertTriangle size={18} className="icon-warning" />
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

        <div className="flex-gap-mt">
          <ActionButton onClick={handleSave} disabled={recording !== null} variant="primary">
            Apply Bindings
          </ActionButton>
          <ActionButton onClick={handleResetDefaults} disabled={recording !== null} variant="secondary">
            Restore Default Hotkeys
          </ActionButton>
        </div>
      </div>

      <div className="col-lg">
        <SectionHeading>In-App Shortcuts</SectionHeading>
        <span className="text-hint-pull">
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

        <div className="flex-gap-mt">
          <ActionButton onClick={handleResetAppDefaults} disabled={recording !== null} variant="secondary">
            Restore Default Shortcuts
          </ActionButton>
        </div>
      </div>

      <div className="col-lg">
        <SectionHeading>View Shortcuts</SectionHeading>
        <span className="text-hint-pull">
          Work only while that view is open, so two of them can share a key without clashing.
          A kanban card also needs to be focused, which Tab does.
        </span>

        {VIEW_SCOPES.map(scope => (
          <div key={scope} className="col">
            <span className="text-hint-strong">
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

        <div className="flex-gap-mt">
          <ActionButton onClick={handleResetViewDefaults} disabled={recording !== null} variant="secondary">
            Restore Default View Shortcuts
          </ActionButton>
        </div>
      </div>

      <div className="col-lg">
        <SectionHeading>Mouse</SectionHeading>
        <span className="text-hint-pull">
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
