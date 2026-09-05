/**
 * Somewhere to point internet sync when STUN is not enough.
 *
 * Two peers behind symmetric NATs, which is what mobile tethering and a lot of
 * corporate networks are, cannot reach each other however patient they are.
 * The fix is a TURN relay carrying the traffic between them, and there is no
 * free public one worth shipping. So the user brings their own, and until they
 * do, nothing here is used or sent anywhere.
 */

import React, { useEffect, useState } from 'react'
import { Route, Check } from 'lucide-react'
import { getStringSetting, setStringSetting } from '../../lib/settings'
import {
  refreshTurnServer, TURN_URL_KEY, TURN_USERNAME_KEY, TURN_CREDENTIAL_KEY
} from '../../lib/webrtcTransport'
import { describeTurnSettings, turnIceServer } from '../../../../shared/iceConfig'

const field: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--color-surface-2)',
  border: '1px solid var(--color-surface-offset)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-base)',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  padding: '6px 8px',
  outline: 'none'
}

const label: React.CSSProperties = {
  display: 'block',
  fontSize: '10px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--color-text-faint)',
  marginBottom: '3px'
}

export default function TurnRelaySettings(): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [credential, setCredential] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      getStringSetting(TURN_URL_KEY, ''),
      getStringSetting(TURN_USERNAME_KEY, ''),
      getStringSetting(TURN_CREDENTIAL_KEY, '')
    ]).then(([u, n, c]) => {
      if (cancelled) return
      setUrl(u)
      setUsername(n)
      setCredential(c)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const problem = describeTurnSettings({ url, username, credential })
  const active = !!turnIceServer({ url, username, credential })

  const save = async (): Promise<void> => {
    await setStringSetting(TURN_URL_KEY, url.trim())
    await setStringSetting(TURN_USERNAME_KEY, username.trim())
    await setStringSetting(TURN_CREDENTIAL_KEY, credential.trim())
    // The transport caches this, because a peer connection is built in
    // synchronous code and cannot wait on a setting.
    await refreshTurnServer()
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
  }

  return (
    <div style={{
      marginTop: 'var(--space-4)',
      padding: 'var(--space-4)',
      background: 'var(--color-surface-1)',
      border: '1px solid var(--color-surface-offset)',
      borderRadius: 'var(--radius-md)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
        <Route size={14} style={{ color: 'var(--color-secondary)' }} />
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-base)' }}>
          Relay server (optional)
        </span>
        {active && (
          <span style={{
            padding: '1px 6px', borderRadius: 'var(--radius-full, 999px)',
            background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)',
            fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em'
          }}>
            in use
          </span>
        )}
      </div>

      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', lineHeight: 1.5, margin: '0 0 var(--space-3)' }}>
        Internet sync finds a direct route between two machines on its own most
        of the time. When both ends are behind a strict NAT, which is common on
        mobile tethering and office networks, it cannot, and a relay has to
        carry the traffic. Checkpoint ships no relay: point this at your own
        coturn or a hosted one. LAN sync never needs it.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div>
          <label style={label} htmlFor="turn-url">Server URL</label>
          <input
            id="turn-url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="turn:relay.example.com:3478"
            spellCheck={false}
            style={field}
          />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <label style={label} htmlFor="turn-user">Username</label>
            <input
              id="turn-user"
              value={username}
              onChange={e => setUsername(e.target.value)}
              spellCheck={false}
              style={field}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={label} htmlFor="turn-pass">Password</label>
            <input
              id="turn-pass"
              type="password"
              value={credential}
              onChange={e => setCredential(e.target.value)}
              spellCheck={false}
              style={field}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
        <button
          onClick={() => void save()}
          style={{
            fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-semibold)',
            background: 'var(--color-secondary)', color: 'var(--color-text-inverted)',
            border: 'none', padding: '6px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer'
          }}
        >
          Save
        </button>
        {saved && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--color-success, var(--color-secondary))' }}>
            <Check size={12} /> Saved
          </span>
        )}
        {problem && (
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>{problem}</span>
        )}
      </div>

      <p style={{ fontSize: '10px', color: 'var(--color-text-faint)', lineHeight: 1.5, margin: 'var(--space-3) 0 0' }}>
        The password is encrypted with the OS keychain and never leaves this
        machine, including when syncing with a paired one.
      </p>
    </div>
  )
}
