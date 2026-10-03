/** a task typed straight in: Enter adds it and the box stays ready for the next, a date in the words becomes its due date */

import { forwardRef, useState } from 'react'
import { CalendarClock, Plus } from 'lucide-react'
import { parseNaturalDate } from '../../../../shared/naturalDate'
import { formatDue } from '../../../../shared/dueDate'

interface Props {
  /** true once the task is made, so the box can clear */
  onAdd: (title: string, dueAt: number | null) => Promise<boolean>
}

const QuickAddTask = forwardRef<HTMLInputElement, Props>(function QuickAddTask({ onAdd }, ref) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const parsed = parseNaturalDate(draft)
  // all date and no words would make a task called nothing, so the words win
  const title = parsed.cleanedText || draft.trim()

  const submit = async (): Promise<void> => {
    if (!title || adding) return
    setAdding(true)
    try {
      if (await onAdd(title, parsed.cleanedText ? parsed.dueAt : null)) setDraft('')
    } finally {
      setAdding(false)
    }
  }

  return (
    <form
      onSubmit={e => { e.preventDefault(); void submit() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)', flexShrink: 0,
        background: 'var(--color-surface-1)',
        border: '1px solid var(--color-surface-offset)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-1) var(--space-1) var(--space-1) var(--space-3)'
      }}
    >
      <Plus size={14} className="icon-faint" style={{ flexShrink: 0 }} />
      <input
        ref={ref}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') setDraft('') }}
        placeholder="Add a task. A date like “fri 3pm” sets when it’s due"
        aria-label="New task"
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none',
          color: 'var(--color-text-base)', fontSize: 'var(--text-sm)',
          padding: 'var(--space-1) 0', outline: 'none'
        }}
      />
      {parsed.dueAt !== null && parsed.cleanedText && (
        <span
          title={`“${parsed.matched}” read as the due date`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0,
            padding: '2px 8px', borderRadius: '999px',
            background: 'var(--color-secondary-muted)', color: 'var(--color-secondary)',
            fontSize: 'var(--text-xs)', whiteSpace: 'nowrap'
          }}
        >
          <CalendarClock size={12} />
          Due {formatDue(parsed.dueAt)}
        </span>
      )}
      <button
        type="submit"
        disabled={!title || adding}
        className="btn-primary"
        style={{ padding: 'var(--space-1) var(--space-3)', fontSize: 'var(--text-xs)', flexShrink: 0 }}
      >
        {adding ? 'Adding…' : 'Add'}
      </button>
    </form>
  )
})

export default QuickAddTask
