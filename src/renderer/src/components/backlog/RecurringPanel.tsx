import React, { useCallback, useEffect, useState } from 'react'
import { Repeat, Plus, Trash2, Pause, Play, X } from 'lucide-react'
import { useToast } from '../ui/Toast'
import type { RecurrenceSummary } from '../../../../shared/recurrence'
import * as recurrenceApi from '../../data/recurrence'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

interface Props {
  context: string
  /** Called after anything changes, so the task list can reload. */
  onChanged?: () => void
}

/** Today at 9am. A saner default than "this exact second" for repeating work. */
function defaultStart(): string {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function RecurringPanel({ context, onChanged }: Props): React.JSX.Element {
  const { toast } = useToast()
  const [rules, setRules] = useState<RecurrenceSummary[]>([])
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [freq, setFreq] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [interval, setInterval] = useState(1)
  const [byWeekday, setByWeekday] = useState<number[]>([])
  const [startAt, setStartAt] = useState(defaultStart)

  const load = useCallback(async () => {
    try {
      setRules(await recurrenceApi.list(context))
    } catch (err) {
      console.error('Failed to load recurrences:', err)
    }
  }, [context])

  useEffect(() => { load() }, [load])

  const reset = () => {
    setAdding(false)
    setTitle('')
    setByWeekday([])
    setInterval(1)
    setStartAt(defaultStart())
  }

  const handleCreate = async () => {
    if (!title.trim()) { toast('Give the repeating task a title'); return }
    // datetime-local has no timezone, so this parses as local time, which is
    // what the rule means by "9am".
    const start = new Date(startAt).getTime()
    if (!Number.isFinite(start)) { toast('That start date is not valid'); return }

    const result = await recurrenceApi.create({
      context,
      title: title.trim(),
      type: 'task',
      rule: { freq, interval, byWeekday: freq === 'weekly' ? byWeekday : [], startAt: start, untilAt: null }
    })
    if (!result.ok) { toast(result.reason ?? 'Could not create that repeat'); return }

    toast(`"${title.trim()}" will repeat`)
    reset()
    await load()
    onChanged?.()
  }

  const handleDelete = async (rule: RecurrenceSummary) => {
    await recurrenceApi.remove(rule.id)
    toast(`Stopped "${rule.title}" repeating`)
    await load()
  }

  const handleToggle = async (rule: RecurrenceSummary) => {
    await recurrenceApi.setActive(rule.id, !rule.active)
    await load()
  }

  const fieldStyle: React.CSSProperties = {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-surface-offset)',
    color: 'var(--color-text-base)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-1-5) var(--space-2)',
    fontSize: 'var(--text-xs)',
    outline: 'none'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)', textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wider)'
        }}>
          <Repeat size={13} />
          Repeating
        </span>
        {!adding && (
          <button className="btn-secondary" onClick={() => setAdding(true)} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <Plus size={12} />
            Add
          </button>
        )}
      </div>

      {adding && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
          padding: 'var(--space-3)', background: 'var(--color-surface-1)',
          border: '1px solid var(--color-surface-offset)', borderRadius: 'var(--radius-md)'
        }}>
          <input
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') reset() }}
            placeholder="What repeats?"
            aria-label="Repeating task title"
            style={{ ...fieldStyle, fontSize: 'var(--text-sm)' }}
          />

          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Every</span>
            <input
              type="number"
              min={1}
              max={365}
              value={interval}
              onChange={e => setInterval(Math.max(1, Number(e.target.value) || 1))}
              aria-label="Repeat interval"
              style={{ ...fieldStyle, width: '58px' }}
            />
            <select
              value={freq}
              onChange={e => setFreq(e.target.value as typeof freq)}
              aria-label="Repeat frequency"
              style={{ ...fieldStyle, cursor: 'pointer' }}
            >
              <option value="daily">day(s)</option>
              <option value="weekly">week(s)</option>
              <option value="monthly">month(s)</option>
            </select>
          </div>

          {freq === 'weekly' && (
            <div style={{ display: 'flex', gap: '4px' }}>
              {WEEKDAYS.map((label, day) => {
                const on = byWeekday.includes(day)
                return (
                  <button
                    key={day}
                    onClick={() => setByWeekday(d => (on ? d.filter(x => x !== day) : [...d, day].sort()))}
                    aria-label={`Toggle day ${day}`}
                    aria-pressed={on}
                    style={{
                      width: '26px', height: '26px', borderRadius: 'var(--radius-md)',
                      background: on ? 'var(--color-secondary-muted)' : 'var(--color-surface-2)',
                      border: `1px solid ${on ? 'var(--color-secondary)' : 'var(--color-surface-offset)'}`,
                      color: on ? 'var(--color-secondary)' : 'var(--color-text-muted)',
                      fontSize: '11px', cursor: 'pointer'
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            Starting
            <input
              type="datetime-local"
              value={startAt}
              onChange={e => setStartAt(e.target.value)}
              style={{ ...fieldStyle, flex: 1 }}
            />
          </label>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn-primary" onClick={handleCreate}>Create</button>
            <button className="btn-secondary" onClick={reset} aria-label="Cancel"><X size={13} /></button>
          </div>
        </div>
      )}

      {rules.length === 0 && !adding && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)' }}>
          Nothing repeats yet. One task appears at a time, and the next only after you finish the last.
        </div>
      )}

      {rules.map(rule => (
        <div
          key={rule.id}
          style={{
            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            opacity: rule.active ? 1 : 0.55
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-base)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {rule.title}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--color-text-faint)', marginTop: '2px' }}>
              {rule.description}
              {rule.active && rule.nextDue ? ` · next ${new Date(rule.nextDue).toLocaleDateString()}` : ''}
              {!rule.active ? ' · paused' : ''}
            </div>
          </div>
          <button
            className="btn-secondary"
            onClick={() => handleToggle(rule)}
            aria-label={rule.active ? `Pause ${rule.title}` : `Resume ${rule.title}`}
            title={rule.active ? 'Pause' : 'Resume'}
          >
            {rule.active ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            className="btn-secondary"
            onClick={() => handleDelete(rule)}
            aria-label={`Stop ${rule.title} repeating`}
            title="Stop repeating"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
