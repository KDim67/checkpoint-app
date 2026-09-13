import { useState, useEffect } from 'react'
import { FieldRow, ToggleSwitch, Divider, RowBetween } from './SettingsSection'
import { getBoolSetting, getNumberSetting, getStringSetting, setBoolSetting, setNumberSetting, setStringSetting } from '../../lib/settings'
import * as appApi from '../../data/app'
import * as widgetApi from '../../data/widget'

// Widget Settings
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
    { value: 'top-left',     label: '↖ Top Left'      },
    { value: 'top-right',    label: '↗ Top Right'     },
    { value: 'bottom-left',  label: '↙ Bottom Left'   },
    { value: 'bottom-right', label: '↘ Bottom Right'  }
  ]

  return (
    <div className="col-xl">
      <RowBetween>
        <div>
          <div className="text-item">
            Show Desktop Widget
          </div>
          <div className="text-sub">
            Transparent always-on-top overlay, never steals focus from your IDE.
          </div>
        </div>
        <ToggleSwitch checked={enabled} onChange={handleToggle} label="Show Desktop Widget" />
      </RowBetween>

      {enabled && (
        <>
          <Divider />
          <FieldRow label="Position">
            <div className="flex-wrap-gap">
              {POSITIONS.map(p => (
                <button
                  key={p.value}
                  onClick={() => handlePosition(p.value)}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    background: position === p.value ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                    border: `1px solid ${position === p.value ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                    color: position === p.value ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                    borderRadius: 'var(--radius-md)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-xs)',
                    transition: 'all 100ms ease'
                  }}
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
              onChange={e => handleOpacity(parseFloat(e.target.value))}
              className="range-accent"
            />
          </FieldRow>
        </>
      )}
    </div>
  )
}
