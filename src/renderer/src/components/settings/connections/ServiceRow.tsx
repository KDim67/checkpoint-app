/** one service on the Connections tab: how to connect it, then who it is connected as, what it follows, and a way out */

import React, { useState } from 'react'
import { RefreshCw, Unplug } from 'lucide-react'
import * as connectionsApi from '../../../data/connections'
import { useConfirm } from '../../ui/ConfirmDialog'
import { SERVICES, type ServiceStatusView } from '../../../../../shared/connections'

const timeOf = (at: number): string => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export interface ConnectField {
  name: string
  label: string
  placeholder: string
  /** typed as a password: never shown, never autofilled */
  secret?: boolean
  type?: 'text' | 'email'
}

interface Props {
  view: ServiceStatusView
  icon: React.ReactNode
  /** what connecting does, in a sentence or two */
  summary: string
  /** how to make a key there, as list items */
  steps: React.ReactNode
  /** what to ask for; a single key when absent */
  fields?: ConnectField[]
  keyLabel?: string
  placeholder?: string
  /** who it is connected as, set the way the service writes it */
  who: React.ReactNode
  /** said after who, such as when the key stops working */
  more?: string
  disconnectMessage: string
  onChange: (view: ServiceStatusView) => void
  /** what each workspace follows */
  children: React.ReactNode
}

export default function ServiceRow({ view, icon, summary, steps, fields, keyLabel = 'Key', placeholder = '', who, more, disconnectMessage, onChange, children }: Props): React.JSX.Element {
  const confirm = useConfirm()
  const { name } = SERVICES[view.service]
  const asked: ConnectField[] = fields ?? [{ name: 'key', label: keyLabel, placeholder, secret: true }]
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const complete = asked.every(f => (values[f.name] ?? '').trim() !== '')

  const connect = async (): Promise<void> => {
    setBusy('connect')
    setError(null)
    try {
      // a single key goes as itself; several fields go together
      const credential = fields ? values : values[asked[0].name] ?? ''
      const result = await connectionsApi.connect(view.service, credential)
      if (result.ok) {
        setValues({})
        onChange(result.value)
      } else {
        setError(result.reason)
      }
    } finally {
      setBusy(null)
    }
  }

  const syncNow = async (): Promise<void> => {
    setBusy('sync')
    try {
      onChange(await connectionsApi.syncNow(view.service))
    } finally {
      setBusy(null)
    }
  }

  const disconnect = async (): Promise<void> => {
    const ok = await confirm({ title: `Disconnect ${name}?`, message: disconnectMessage, confirmText: 'Disconnect', isDestructive: true })
    if (!ok) return
    setBusy('disconnect')
    try {
      onChange(await connectionsApi.disconnect(view.service))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="connection-row" role="group" aria-label={name}>
      <div className="connection-head">
        {icon}
        <span className="text-item-strong">{name}</span>
        <span className="plugin-status" data-status={!view.connected ? 'off' : view.problem ? 'needs-approval' : 'running'}>
          {!view.connected ? 'Not connected' : view.problem ? 'Needs a look' : 'Connected'}
        </span>
      </div>
      <p className="text-sub">{summary}</p>

      {!view.connected ? (
        <>
          <ol className="connection-steps">{steps}</ol>
          <form className="connection-key" data-fields={asked.length > 1 ? 'many' : undefined} onSubmit={e => { e.preventDefault(); void connect() }}>
            {asked.map(f => (
              <input
                key={f.name}
                type={f.secret ? 'password' : f.type ?? 'text'}
                className="input-xs"
                aria-label={f.label}
                placeholder={f.placeholder}
                value={values[f.name] ?? ''}
                autoComplete="off"
                spellCheck={false}
                onChange={e => setValues(current => ({ ...current, [f.name]: e.target.value }))}
              />
            ))}
            <button type="submit" className="btn-primary" disabled={busy !== null || !complete}>
              {busy === 'connect' ? 'Checking...' : 'Connect'}
            </button>
          </form>
          {error && <p className="connection-problem" role="alert">{error}</p>}
        </>
      ) : (
        <>
          <p className="text-sub">
            Connected as {who}.
            {more}
            {view.lastOk !== null ? ` Last checked at ${timeOf(view.lastOk)}.` : ' Checking for the first time...'}
          </p>
          {view.problem && <p className="connection-problem" role="alert">{view.problem}</p>}
          <div className="connection-repos">{children}</div>
          <div className="connection-actions">
            <button type="button" className="btn-secondary" disabled={busy !== null} onClick={() => void syncNow()}>
              <span className="row-4px"><RefreshCw size={13} aria-hidden="true" className={busy === 'sync' ? 'animate-spin' : undefined} />Sync now</span>
            </button>
            <button type="button" className="btn-ghost" disabled={busy !== null} onClick={() => void disconnect()}>
              <span className="row-4px"><Unplug size={13} aria-hidden="true" />Disconnect</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
