/** symmetric NATs need a TURN relay and no free one is worth shipping; unused until set */

import React, { useEffect, useState } from 'react'
import { Route, Check } from 'lucide-react'
import * as syncApi from '../../data/sync'
import { refreshTurnServer } from '../../lib/webrtcTransport'
import { describeTurnSettings, turnIceServer } from '../../../../shared/iceConfig'
import { SAVED_FEEDBACK_MS } from '../../lib/timings'
import SettingsSection, { FieldRow, SettingsInput } from './SettingsSection'

export default function TurnRelaySettings(): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [credential, setCredential] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    syncApi.getTurnRelay().then(relay => {
      if (cancelled) return
      setUrl(relay.url)
      setUsername(relay.username)
      setCredential(relay.credential)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const problem = describeTurnSettings({ url, username, credential })
  const active = !!turnIceServer({ url, username, credential })

  const save = async (): Promise<void> => {
    await syncApi.setTurnRelay({ url, username, credential })
    // the transport caches it, peer connections are built synchronously
    await refreshTurnServer()
    setSaved(true)
    setTimeout(() => setSaved(false), SAVED_FEEDBACK_MS)
  }

  return (
    <SettingsSection icon={<Route size={14} />} title="Relay Server" description="Optional. Only for internet sync between two strict networks.">
      <div className="col-lg">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <p className="text-sub" style={{ margin: 0, flex: '1 1 20rem', lineHeight: 'var(--leading-relaxed)' }}>
            Internet sync usually finds a direct route between two computers. Behind a strict network, such as a phone's
            hotspot or an office, it can't, and a relay has to carry the traffic. Checkpoint doesn't come with one, so
            point this at your own TURN server or a hosted one. Sync on your own network never needs it.
          </p>
          {active && <span className="plugin-status" data-status="running">In use</span>}
        </div>

        <FieldRow label="Server address">
          <SettingsInput
            value={url}
            onChange={setUrl}
            placeholder="turn:relay.example.com:3478"
          />
        </FieldRow>

        <div className="flex-gap" style={{ flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 12rem' }}>
            <FieldRow label="Username">
              <SettingsInput value={username} onChange={setUsername} />
            </FieldRow>
          </div>
          <div style={{ flex: '1 1 12rem' }}>
            <FieldRow label="Password" hint="Kept encrypted on this computer, and never sent to a computer you sync with.">
              <SettingsInput type="password" value={credential} onChange={setCredential} />
            </FieldRow>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <button type="button" className="btn-primary" onClick={() => void save()}>
            Save
          </button>
          <span role="status" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-xs)' }}>
            {saved && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--color-success)' }}>
                <Check size={12} aria-hidden="true" /> Saved
              </span>
            )}
            {problem && <span style={{ color: 'var(--color-warning)' }}>{problem}</span>}
          </span>
        </div>
      </div>
    </SettingsSection>
  )
}
