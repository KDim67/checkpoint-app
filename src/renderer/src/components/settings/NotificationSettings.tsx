import React, { useEffect, useState } from 'react'
import { FieldRow, ToggleSwitch, RowBetween, Divider } from './SettingsSection'
import { useToast } from '../ui/Toast'
import {
  DEFAULT_POLICY,
  NOTIFICATION_CATEGORIES,
  isQuietHour,
  type NotificationPolicy
} from '../../../../shared/notificationPolicy'
import * as notificationsApi from '../../data/notifications'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`

export default function NotificationSettings(): React.JSX.Element {
  const { toast } = useToast()
  const [policy, setPolicy] = useState<NotificationPolicy>(DEFAULT_POLICY)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    notificationsApi.getPolicy()
      .then(p => { setPolicy(p); setLoaded(true) })
      .catch(err => { console.error('Failed to load notification policy:', err); setLoaded(true) })
  }, [])

  const save = async (next: NotificationPolicy) => {
    // Applied locally first so the controls stay responsive; main returns the
    // normalized copy, which is what actually governs.
    setPolicy(next)
    try {
      const stored = await notificationsApi.setPolicy(next)
      setPolicy(stored)
    } catch (err) {
      console.error(err)
      toast('Could not save notification settings')
    }
  }

  const setCategory = (id: string, on: boolean) =>
    save({ ...policy, categories: { ...policy.categories, [id]: on } })

  const selectStyle: React.CSSProperties = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-surface-offset)',
    color: 'var(--color-text-base)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-1-5) var(--space-3)',
    fontSize: 'var(--text-xs)',
    outline: 'none',
    cursor: 'pointer'
  }

  if (!loaded) {
    return <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>Loading…</div>
  }

  const quietNow = isQuietHour(policy, new Date().getHours())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <RowBetween>
        <div>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
            Desktop Notifications
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
            The master switch. Everything below is silenced while this is off.
          </div>
        </div>
        <ToggleSwitch
          checked={policy.enabled}
          onChange={on => save({ ...policy, enabled: on })}
          label="Desktop Notifications"
        />
      </RowBetween>

      <Divider />

      <div style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
        opacity: policy.enabled ? 1 : 0.5,
        pointerEvents: policy.enabled ? 'auto' : 'none',
        transition: 'opacity 200ms ease'
      }}>
        <h4 style={{
          margin: 0, fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)', textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wider)'
        }}>
          What to tell you about
        </h4>

        {NOTIFICATION_CATEGORIES.map(category => (
          <div
            key={category.id}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-surface-1)',
              border: '1px solid var(--color-surface-offset)',
              borderRadius: 'var(--radius-md)'
            }}
          >
            <div style={{ marginRight: 'var(--space-4)', flex: 1 }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-base)', display: 'block' }}>
                {category.label}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--color-text-muted)' }}>
                {category.description}
              </span>
            </div>
            <ToggleSwitch
              checked={policy.categories[category.id] !== false}
              onChange={on => setCategory(category.id, on)}
              label={category.label}
            />
          </div>
        ))}

        <Divider />

        <RowBetween>
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
              Quiet Hours
              {policy.quietEnabled && quietNow && (
                <span style={{ marginLeft: 'var(--space-2)', fontSize: '11px', color: 'var(--color-secondary)' }}>
                  active now
                </span>
              )}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
              Nothing is raised during this window. It may cross midnight.
            </div>
          </div>
          <ToggleSwitch
            checked={policy.quietEnabled}
            onChange={on => save({ ...policy, quietEnabled: on })}
            label="Quiet Hours"
          />
        </RowBetween>

        {policy.quietEnabled && (
          <FieldRow label="Window">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <select
                value={policy.quietFrom}
                onChange={e => save({ ...policy, quietFrom: Number(e.target.value) })}
                aria-label="Quiet hours start"
                style={selectStyle}
              >
                {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>to</span>
              <select
                value={policy.quietTo}
                onChange={e => save({ ...policy, quietTo: Number(e.target.value) })}
                aria-label="Quiet hours end"
                style={selectStyle}
              >
                {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </div>
          </FieldRow>
        )}

        <Divider />

        <RowBetween>
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-text-base)' }}>
              Send a test
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: '2px' }}>
              Checks the settings above, and that the OS is letting them through.
            </div>
          </div>
          <button
            className="btn-secondary"
            onClick={async () => {
              const fired = await notificationsApi.send({
                category: 'due',
                title: 'Checkpoint',
                body: 'Notifications are working.'
              })
              // Saying why nothing appeared beats leaving the user guessing
              // whether the feature or the OS is at fault.
              toast(fired ? 'Sent' : 'Suppressed: check the switches and quiet hours above')
            }}
          >
            Test
          </button>
        </RowBetween>
      </div>
    </div>
  )
}
