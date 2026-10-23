import { useState, useEffect } from 'react'
import { FieldRow, ToggleRow, Divider } from './SettingsSection'
import { getBoolSetting, getNumberSetting, getStringSetting, setBoolSetting, setNumberSetting, setStringSetting } from '../../lib/settings'
import * as appApi from '../../data/app'
import * as widgetApi from '../../data/widget'

export default function WidgetSettings() {
  const isWindows = appApi.platform() === 'win32'
  const [enabled, setEnabled] = useState(false)
  const [position, setPosition] = useState<'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('bottom-right')
  const [opacity, setOpacity] = useState(0.9)

  useEffect(() => {
    const load = async () => {
      setEnabled(await getBoolSetting('widget_enabled', false))
      setPosition(await getStringSetting('widget_position', 'bottom-right') as typeof position)
      setOpacity(await getNumberSetting('widget_opacity', 0.9))
    }
    load()
  }, [])

  if (!isWindows) {
    return (
      <div style={{
        padding: 'var(--space-4)',
        background: 'var(--color-surface-2)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text-faint)',
        fontSize: 'var(--text-sm)'
      }}>
        The desktop widget is only available on Windows.
      </div>
    )
  }

  const handleToggle = async (v: boolean) => {
    setEnabled(v)
    await setBoolSetting('widget_enabled', v)
    await widgetApi.toggle(v)
  }

  const handlePosition = async (p: typeof position) => {
    setPosition(p)
    await setStringSetting('widget_position', p)
    await widgetApi.setPosition(p)
  }

  const handleOpacity = async (o: number) => {
    setOpacity(o)
    await setNumberSetting('widget_opacity', o)
    await widgetApi.setOpacity(o)
  }

  const POSITIONS: { value: typeof position; label: string }[] = [
    { value: 'top-left',     label: 'Top left'     },
    { value: 'top-right',    label: 'Top right'    },
    { value: 'bottom-left',  label: 'Bottom left'  },
    { value: 'bottom-right', label: 'Bottom right' }
  ]

  return (
    <div className="col-xl">
      <ToggleRow
        label="Show desktop widget"
        description="It stays on top without taking the keyboard from whatever you're working in."
        checked={enabled}
        onChange={handleToggle}
      />

      {enabled && (
        <>
          <Divider />
          <FieldRow label="Corner of the screen" group>
            <div className="settings-choices" data-fit="">
              {POSITIONS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  className="settings-choice"
                  aria-pressed={position === p.value}
                  onClick={() => handlePosition(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </FieldRow>

          <FieldRow label={`Opacity, ${Math.round(opacity * 100)}%`}>
            <input
              type="range"
              min={0.3}
              max={1.0}
              step={0.05}
              value={opacity}
              aria-valuetext={`${Math.round(opacity * 100)}%`}
              onChange={e => handleOpacity(parseFloat(e.target.value))}
              className="range-accent"
            />
          </FieldRow>
        </>
      )}
    </div>
  )
}
