import React, { useState } from 'react'
import Popover from './Popover'
import type { WorkspaceEntry } from '../../lib/createWorkspace'

interface Props {
  at: { x: number; y: number }
  /** said back so it's clear what day and time the new one gets */
  when: string
  workspaces: WorkspaceEntry[]
  /** offered only while every workspace is on screen; otherwise it is the current one */
  pickWorkspace: boolean
  defaultWorkspace: string
  onAdd: (input: { title: string; type: 'task' | 'card'; context: string }) => Promise<boolean>
  onClose: () => void
}

/** a title and Enter; the date is already the one clicked */
export default function QuickAdd({ at, when, workspaces, pickWorkspace, defaultWorkspace, onAdd, onClose }: Props): React.JSX.Element {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<'task' | 'card'>('task')
  const [context, setContext] = useState(defaultWorkspace)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      if (await onAdd({ title: title.trim(), type, context })) onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover at={at} label="Add to the calendar" onClose={onClose}>
      <form className="cal-quick-add" onSubmit={e => { e.preventDefault(); void submit() }}>
        <div className="cal-popover-title">{when}</div>
        <input
          className="cal-input"
          autoFocus
          placeholder="What's due?"
          aria-label="Title"
          value={title}
          onChange={e => setTitle(e.target.value)}
        />
        <div className="cal-quick-row">
          <span className="row-4px" role="radiogroup" aria-label="Kind">
            {(['task', 'card'] as const).map(t => (
              <button key={t} type="button" role="radio" aria-checked={type === t} className="renewal-filter" onClick={() => setType(t)}>
                {t === 'task' ? 'Task' : 'Card'}
              </button>
            ))}
          </span>
          {pickWorkspace && (
            <select className="cal-input cal-select" aria-label="Workspace" value={context} onChange={e => setContext(e.target.value)}>
              {workspaces.map(w => <option key={w.slug} value={w.slug}>{w.name}</option>)}
            </select>
          )}
        </div>
        <div className="cal-popover-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!title.trim() || busy}>Add</button>
        </div>
      </form>
    </Popover>
  )
}
