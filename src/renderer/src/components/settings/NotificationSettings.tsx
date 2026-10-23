import React, { useEffect, useState } from 'react'
import { Bell, Moon } from 'lucide-react'
import SettingsSection, { FieldRow, ToggleSwitch, ToggleRow, RowBetween, Divider, SettingsCardSkeleton } from './SettingsSection'
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
    // local first for responsiveness; main's normalized copy is what governs
    setPolicy(next)
    try {
      const stored = await notificationsApi.setPolicy(next)
      setPolicy(stored)
    } catch (err) {
      console.error(err)
      toast('Could not save that. Try again.')
    }
  }

  const setCategory = (id: string, on: boolean) =>
    save({ ...policy, categories: { ...policy.categories, [id]: on } })

  if (!loaded) {
    return <SettingsCardSkeleton label="Loading the notifications" rows={4} />
  }

  const quietNow = isQuietHour(policy, new Date().getHours())

  return (
    <>
      <SettingsSection icon={<Bell size={14} />} title="Desktop Notifications" description="Pop-ups from Checkpoint in the corner of the screen.">
        <div className="col-xl">
          <ToggleRow
            label="Desktop notifications"
            description="The switch for all of them. Nothing below shows while this is off."
            checked={policy.enabled}
            onChange={on => save({ ...policy, enabled: on })}
          />

          <Divider />

          {/* switched off, the controls are disabled rather than faded, so the keyboard skips them too */}
          <fieldset className="settings-fieldset" disabled={!policy.enabled}>
            <legend className="heading-caps" style={{ marginBottom: 'var(--space-3)' }}>
              What to tell you about
            </legend>
            <ul className="settings-list">
              {NOTIFICATION_CATEGORIES.map(category => (
                <li key={category.id} className="settings-list-row">
                  <div className="settings-row-text">
                    <label htmlFor={`notify-${category.id}`} className="field-label" style={{ cursor: 'pointer' }}>
                      {category.label}
                    </label>
                    <span id={`notify-${category.id}-description`} className="text-sub">
                      {category.description}
                    </span>
                  </div>
                  <ToggleSwitch
                    id={`notify-${category.id}`}
                    checked={policy.categories[category.id] !== false}
                    onChange={on => setCategory(category.id, on)}
                    describedBy={`notify-${category.id}-description`}
                  />
                </li>
              ))}
            </ul>

            <RowBetween>
              <div className="settings-row-text">
                <div className="text-item">
                  Send a test
                </div>
                <div className="text-sub">
                  Shows one now, which also checks that Windows lets them through.
                </div>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  const fired = await notificationsApi.send({
                    category: 'due',
                    title: 'Checkpoint',
                    body: 'Notifications are working.'
                  })
                  // say why nothing appeared, feature or OS
                  toast(fired ? 'Sent' : 'Nothing was sent. Check Due dates above and quiet hours below.')
                }}
              >
                Send a test
              </button>
            </RowBetween>
          </fieldset>
        </div>
      </SettingsSection>

      <SettingsSection icon={<Moon size={14} />} title="Quiet Hours" description="A daily window when nothing pops up.">
        <div className="col-lg">
          <ToggleRow
            label="Quiet hours"
            description="It can run past midnight, such as 22:00 to 07:00."
            checked={policy.quietEnabled}
            onChange={on => save({ ...policy, quietEnabled: on })}
            disabled={!policy.enabled}
          >
            {policy.enabled && policy.quietEnabled && quietNow && (
              <div className="settings-note">
                <Moon size={12} aria-hidden="true" />
                Quiet now.
              </div>
            )}
          </ToggleRow>

          {policy.quietEnabled && (
            <FieldRow label="From and to" group>
              <div className="row">
                <select
                  value={policy.quietFrom}
                  onChange={e => save({ ...policy, quietFrom: Number(e.target.value) })}
                  aria-label="Quiet from"
                  className="select-md"
                  disabled={!policy.enabled}
                >
                  {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
                <span className="text-hint" aria-hidden="true">to</span>
                <select
                  value={policy.quietTo}
                  onChange={e => save({ ...policy, quietTo: Number(e.target.value) })}
                  aria-label="Quiet until"
                  className="select-md"
                  disabled={!policy.enabled}
                >
                  {HOURS.map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
                </select>
              </div>
            </FieldRow>
          )}
        </div>
      </SettingsSection>
    </>
  )
}
