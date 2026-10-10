import React, { useState } from 'react'
import { CalendarPlus, RefreshCw } from 'lucide-react'
import ModalShell from '../ui/ModalShell'
import * as calendarApi from '../../data/calendar'
import { WORKSPACE_COLORS, type WorkspaceEntry } from '../../lib/createWorkspace'
import { cssVars } from './actions'
import type { CalendarSubscription } from '../../../../shared/calendarApi'

interface Props {
  subscriptions: CalendarSubscription[]
  workspaces: WorkspaceEntry[]
  onChanged: () => void
  onClose: () => void
}

const updatedAt = (s: CalendarSubscription): string =>
  s.lastOk ? `Updated ${new Date(s.lastOk).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Not updated yet'

/** add one by its private link, and see each calendar's state; the link itself never comes back to this screen */
export default function CalendarsModal({ subscriptions, workspaces, onChanged, onClose }: Props): React.JSX.Element {
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const [color, setColor] = useState(WORKSPACE_COLORS[0])
  const [workspace, setWorkspace] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const add = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await calendarApi.subscribe({ name, url: link, color, workspace: workspace || null })
      if (!result.ok) {
        setMessage({ kind: 'error', text: result.reason })
        return
      }
      const { subscription, events } = result.value
      setMessage({ kind: 'ok', text: `Added ${subscription.name}: ${events === 1 ? '1 event' : `${events} events`}.` })
      setName('')
      setLink('')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const change = async (id: string, patch: { name?: string; color?: string; workspace?: string | null }): Promise<void> => {
    const result = await calendarApi.updateSubscription(id, patch)
    if (!result.ok) setMessage({ kind: 'error', text: result.reason })
    onChanged()
  }

  const remove = async (id: string): Promise<void> => {
    setConfirming(null)
    const result = await calendarApi.unsubscribe(id)
    if (!result.ok) setMessage({ kind: 'error', text: result.reason })
    onChanged()
  }

  const refreshAll = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await calendarApi.refresh(true)
      onChanged()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <ModalShell label="Calendars" onClose={onClose} width="560px">
      <div className="row-between">
        <div>
          <div className="plugin-consent-title">Calendars</div>
          <div className="text-sub">
            Any calendar with a private iCal link: Google, Outlook, Apple and the rest. Read-only, kept on this computer only.
          </div>
        </div>
        {subscriptions.length > 0 && (
          <button type="button" className="btn-ghost" onClick={() => void refreshAll()} disabled={refreshing} aria-label="Refresh every calendar">
            <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
          </button>
        )}
      </div>

      {subscriptions.length > 0 && (
        <ul className="cal-subscriptions">
          {subscriptions.map(s => (
            <li key={s.id} className="cal-subscription">
              <span className="cal-swatch" style={cssVars({ '--cal-chip-color': s.color })} aria-hidden="true" />
              <div className="fill">
                <input
                  className="cal-input cal-inline-input"
                  defaultValue={s.name}
                  aria-label={`Name of ${s.name}`}
                  onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== s.name) void change(s.id, { name: e.target.value }) }}
                />
                <div className="cal-subscription-meta">
                  <span>{s.host}</span>
                  {s.error ? <span className="cal-subscription-error">{s.error}</span> : <span>{updatedAt(s)}</span>}
                </div>
              </div>
              <select
                className="cal-input cal-select"
                aria-label={`Workspace for ${s.name}`}
                value={s.workspace ?? ''}
                onChange={e => void change(s.id, { workspace: e.target.value || null })}
              >
                <option value="">Every workspace</option>
                {workspaces.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
              </select>
              {confirming === s.id ? (
                <button type="button" className="btn-secondary cal-danger" onClick={() => void remove(s.id)}>Remove it</button>
              ) : (
                <button type="button" className="btn-ghost" onClick={() => setConfirming(s.id)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="cal-subscribe" onSubmit={e => { e.preventDefault(); void add() }}>
        <div className="text-item">Add a calendar</div>
        <input className="cal-input" placeholder="Name, for example Personal" aria-label="Name" value={name} onChange={e => setName(e.target.value)} />
        <input
          className="cal-input"
          placeholder="Private iCal link, https:// or webcal://"
          aria-label="Private iCal link"
          autoComplete="off"
          spellCheck={false}
          value={link}
          onChange={e => setLink(e.target.value)}
        />
        <div className="cal-quick-row">
          <span className="row-4px" role="radiogroup" aria-label="Colour">
            {WORKSPACE_COLORS.map(c => (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={`Colour ${c}`}
                className="cal-swatch cal-swatch-pick" style={cssVars({ '--cal-chip-color': c })} onClick={() => setColor(c)} />
            ))}
          </span>
          <select className="cal-input cal-select" aria-label="Workspace" value={workspace} onChange={e => setWorkspace(e.target.value)}>
            <option value="">Every workspace</option>
            {workspaces.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
          </select>
        </div>
        <div className="text-sub">
          In Google Calendar it is under the calendar's Settings, as "Secret address in iCal format". Anyone with the link can read
          the calendar, so Checkpoint keeps it encrypted and never shows it again.
        </div>
        {message && <div className={message.kind === 'error' ? 'plugin-setting-error' : 'cal-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
        <div className="cal-popover-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Done</button>
          <button type="submit" className="btn-primary" disabled={busy || !name.trim() || !link.trim()}>
            <span className="row-4px"><CalendarPlus size={14} aria-hidden="true" />{busy ? 'Checking…' : 'Add calendar'}</span>
          </button>
        </div>
      </form>
    </ModalShell>
  )
}
