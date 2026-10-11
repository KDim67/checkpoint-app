import React, { useState, useEffect } from 'react'
import { useFailureReport } from '../ui/Toast'
import { useAiEnabled } from '../../lib/useAiEnabled'
import { getEnumSetting, setStringSetting } from '../../lib/settings'
import {
  PAN_BUTTONS_KEY, MENU_BUTTON_KEY, PAN_BUTTON_MODES, MENU_BUTTON_MODES,
  type PanButtons, type MenuButton
} from '../../lib/wallInput'
import { AlertTriangle, Globe, Keyboard, LayoutGrid, Mouse } from 'lucide-react'
import SettingsSection from './SettingsSection'
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
    label: 'Open quick capture',
    desc: 'The bar for jotting a task or log entry, over whatever you have open.',
    defaultKey: 'Ctrl+Shift+Space'
  },
  clipboard_toggle: {
    label: 'Open clipboard history',
    desc: 'Brings Checkpoint to the front on the Clipboard page.',
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
  const id = React.useId()
  return (
    <li className="settings-list-row">
      <div className="settings-row-text">
        <label htmlFor={id} className="field-label">
          {label}
        </label>
        <span id={`${id}-hint`} className="text-sub">{desc}</span>
      </div>
      <select
        id={id}
        value={value}
        aria-describedby={`${id}-hint`}
        onChange={e => onChange(e.target.value as T)}
        className="select-md settings-row-select"
      >
        {choices.map(choice => (
          <option key={choice.value} value={choice.value}>{choice.label}</option>
        ))}
      </select>
    </li>
  )
}

function ShortcutRow({
  label,
  desc,
  combo,
  isRecording,
  problem,
  onStartRecording,
  onStopRecording,
  onKeyDown
}: {
  label: string
  desc?: string
  combo: string
  isRecording: boolean
  /** why the keys just pressed can't be used, said under the row they were meant for */
  problem: string | null
  onStartRecording: () => void
  onStopRecording: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <li
      className="settings-list-row"
      style={{ boxShadow: isRecording ? 'inset 0 0 0 1px var(--color-secondary)' : undefined }}
    >
      <div className="settings-row-text">
        <span className="field-label">
          {label}
        </span>
        {desc && (
          <span className="text-sub">
            {desc}
          </span>
        )}
        {problem && (
          <span role="alert" className="settings-note" data-tone="warning">
            <AlertTriangle size={12} aria-hidden="true" />
            {problem}
          </span>
        )}
      </div>

      {isRecording ? (
        <input
          type="text"
          readOnly
          placeholder="Press the keys…"
          aria-label={`New shortcut for ${label}. Press the keys, or Escape to keep ${combo || 'none'}`}
          onKeyDown={onKeyDown}
          // clicking away keeps the shortcut it had
          onBlur={onStopRecording}
          autoFocus
          className="input-md"
          style={{
            width: '10rem',
            borderColor: 'var(--color-secondary)',
            color: 'var(--color-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            textAlign: 'center'
          }}
        />
      ) : (
        <button
          type="button"
          onClick={onStartRecording}
          aria-label={`Change the shortcut for ${label}, now ${combo || 'none'}`}
          className={`hotkey-binder-shortcut-trigger border-offset ${combo ? 'text-base' : 'text-faint'}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-1-5)',
            minWidth: '7.5rem',
            justifyContent: 'center',
            padding: 'var(--space-1) var(--space-3)',
            background: 'var(--color-surface-2)',
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            cursor: 'pointer',
            transition: 'border-color var(--duration-fast) var(--ease-default)'
          }}
        >
          <Keyboard size={12} aria-hidden="true" />
          {combo || 'None'}
        </button>
      )}
    </li>
  )
}

export default function HotkeyBinder() {
  const report = useFailureReport()
  const aiEnabled = useAiEnabled()
  const [bindings, setBindings] = useState<Record<string, string>>({
    hud_toggle: 'Ctrl+Shift+Space',
    clipboard_toggle: 'Ctrl+Shift+V'
  })
  const [appBindings, setAppBindings] = useState<ShortcutBindings>(defaultBindings)
  const [viewBindings, setViewBindings] = useState<ShortcutBindings>(defaultViewBindings)
  const [panButtons, setPanButtons] = useState<PanButtons>(PAN_BUTTON_MODES[0])
  const [menuButton, setMenuButton] = useState<MenuButton>(MENU_BUTTON_MODES[0])
  const [recording, setRecording] = useState<RecordingTarget | null>(null)
  const [problem, setProblem] = useState<{ target: RecordingTarget; message: string } | null>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const stored = await customizerApi.getShortcuts()
        if (stored && Object.keys(stored).length > 0) {
          setBindings(prev => ({ ...prev, ...stored }))
        }
      } catch (err) {
        report('load your shortcuts', err)
      }
      setAppBindings(await loadBindings())
      setViewBindings(await loadViewBindings())
      setPanButtons(await getEnumSetting(PAN_BUTTONS_KEY, PAN_BUTTON_MODES, PAN_BUTTON_MODES[0]))
      setMenuButton(await getEnumSetting(MENU_BUTTON_KEY, MENU_BUTTON_MODES, MENU_BUTTON_MODES[0]))
    }
    load().catch(err => console.error('Failed to load shortcuts:', err))
  }, [report])

  const startRecording = (target: RecordingTarget) => {
    setRecording(target)
    setProblem(null)
  }

  const stopRecording = () => setRecording(null)

  const problemFor = (target: RecordingTarget): string | null =>
    problem && problem.target.scope === target.scope && problem.target.id === target.id ? problem.message : null

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return

    e.preventDefault()
    e.stopPropagation()

    // Escape keeps what it had
    if (e.key === 'Escape') {
      setRecording(null)
      setProblem(null)
      return
    }

    const combo = comboFromEvent(e)
    if (!combo) return

    const refuse = (message: string): void => setProblem({ target: recording, message })

    if (isReservedCombo(combo)) {
      refuse(`${combo} belongs to Windows or Checkpoint itself. Try another.`)
      return
    }

    if (recording.scope === 'global') {
      const otherAction: GlobalAction = recording.id === 'hud_toggle' ? 'clipboard_toggle' : 'hud_toggle'
      if (bindings[otherAction] === combo) {
        refuse(`${combo} already does "${ACTION_LABELS[otherAction].label}".`)
        return
      }
      const next = { ...bindings, [recording.id]: combo }
      setBindings(next)
      // registered with Windows straight away, like the rest
      customizerApi.registerShortcuts(next).catch(err => report('set the shortcut', err))
    } else if (recording.scope === 'app') {
      // in-app shortcuts fire everywhere, so check every view
      const clash = shortcutClash(combo, { id: recording.id, scope: 'global' }, appBindings, viewBindings)
      if (clash) {
        refuse(`${combo} already does "${clash}".`)
        return
      }
      const next = { ...appBindings, [recording.id]: combo }
      setAppBindings(next)
      // in-window listeners, nothing to register with the OS
      saveBindings(next).catch(err => report('save the shortcut', err))
    } else {
      // another view's keys are free, never on screen together
      const clash = shortcutClash(combo, { id: recording.id, scope: recording.scope }, appBindings, viewBindings)
      if (clash) {
        refuse(`${combo} already does "${clash}".`)
        return
      }
      const next = { ...viewBindings, [recording.id]: combo }
      setViewBindings(next)
      saveViewBindings(next).catch(err => report('save the shortcut', err))
    }

    setRecording(null)
    setProblem(null)
  }

  const handleResetDefaults = async () => {
    const defaults = {
      hud_toggle: ACTION_LABELS.hud_toggle.defaultKey,
      clipboard_toggle: ACTION_LABELS.clipboard_toggle.defaultKey
    }
    setBindings(defaults)
    setProblem(null)
    try {
      await customizerApi.registerShortcuts(defaults)
    } catch (err) {
      report('reset the global shortcuts', err)
    }
  }

  const handleResetAppDefaults = () => {
    const defaults = defaultBindings()
    setAppBindings(defaults)
    setProblem(null)
    saveBindings(defaults).catch(err => report('reset the shortcuts', err))
  }

  const handleResetViewDefaults = () => {
    const defaults = defaultViewBindings()
    setViewBindings(defaults)
    setProblem(null)
    saveViewBindings(defaults).catch(err => report('reset the view shortcuts', err))
  }

  const row = (target: RecordingTarget, label: string, combo: string, desc?: string) => (
    <ShortcutRow
      key={target.id}
      label={label}
      desc={desc}
      combo={combo}
      isRecording={recording?.scope === target.scope && recording.id === target.id}
      problem={problemFor(target)}
      onStartRecording={() => startRecording(target)}
      onStopRecording={stopRecording}
      onKeyDown={handleKeyDown}
    />
  )

  return (
    <>
      <SettingsSection icon={<Globe size={14} />} title="Global Shortcuts" description="Work anywhere in Windows, even while Checkpoint is in the background.">
        <div className="col-md">
          <ul className="settings-list">
            {(Object.keys(ACTION_LABELS) as GlobalAction[]).map(action =>
              row({ scope: 'global', id: action }, ACTION_LABELS[action].label, bindings[action], ACTION_LABELS[action].desc)
            )}
          </ul>
          <div>
            <button type="button" className="btn-secondary btn-small" onClick={handleResetDefaults} disabled={recording !== null}>
              Restore the default global shortcuts
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Keyboard size={14} />} title="In-App Shortcuts" description="Work while the Checkpoint window is in front, but not while you're typing.">
        <div className="col-md">
          <ul className="settings-list">
            {APP_SHORTCUTS.filter(s => s.action.kind !== 'toggleAiPanel' || aiEnabled).map(shortcut =>
              row({ scope: 'app', id: shortcut.id }, shortcut.label, appBindings[shortcut.id])
            )}
          </ul>
          <div>
            <button type="button" className="btn-secondary btn-small" onClick={handleResetAppDefaults} disabled={recording !== null}>
              Restore the default in-app shortcuts
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<LayoutGrid size={14} />} title="View Shortcuts" description="Work only while their view is open, so two views can share a key. A Kanban card needs focus first, which Tab gives it.">
        <div className="col-lg">
          {VIEW_SCOPES.map(scope => (
            <div key={scope}>
              <h3 className="settings-list-title">
                {SCOPE_LABELS[scope]}
              </h3>
              <ul className="settings-list" aria-label={SCOPE_LABELS[scope]}>
                {VIEW_SHORTCUTS.filter(s => s.scope === scope).map(shortcut =>
                  row({ scope, id: shortcut.id }, shortcut.label, viewBindings[shortcut.id])
                )}
              </ul>
            </div>
          ))}
          <div>
            <button type="button" className="btn-secondary btn-small" onClick={handleResetViewDefaults} disabled={recording !== null}>
              Restore the default view shortcuts
            </button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Mouse size={14} />} title="Mouse" description="On the Wall, where the right button both pans and opens the menu. Space and a left-button drag always pans.">
        <ul className="settings-list">
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
        </ul>
      </SettingsSection>
    </>
  )
}
