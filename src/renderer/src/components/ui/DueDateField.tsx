/** a due date typed the way it is said, "fri 3pm" or "20 oct", with the calendar a click away */

import { useRef, useState } from 'react'
import { CalendarDays, X } from 'lucide-react'
import { parseDueText } from '../../../../shared/naturalDate'
import { dateInputValue, formatDue, fromDateInput } from '../../../../shared/dueDate'

interface Props {
  value: number | null
  onChange: (dueAt: number | null) => void
  disabled?: boolean
  /** for a label elsewhere to point at */
  id?: string
}

export default function DueDateField({ value, onChange, disabled = false, id }: Props): React.JSX.Element {
  /** null while it shows the saved date, the words while they are being typed */
  const [draft, setDraft] = useState<string | null>(null)
  const pickerRef = useRef<HTMLInputElement>(null)

  const reading = draft === null ? undefined : parseDueText(draft)
  const shown = draft ?? (value === null ? '' : formatDue(value))

  const commit = (): void => {
    if (draft === null) return
    const next = parseDueText(draft)
    // unreadable words stay on screen with the hint, rather than quietly becoming nothing
    if (next === undefined) return
    setDraft(null)
    if (next !== value) onChange(next)
  }

  return (
    <div className="col-sm" style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
        background: 'var(--color-surface-1)',
        border: `1px solid ${reading === undefined && draft !== null && draft.trim() ? 'var(--color-error)' : 'var(--color-surface-offset)'}`,
        borderRadius: 'var(--radius-md)',
        padding: '0 var(--space-1) 0 var(--space-3)'
      }}>
        <input
          id={id}
          type="text"
          value={shown}
          disabled={disabled}
          placeholder="No due date"
          aria-label="Due date"
          aria-describedby={id ? `${id}-hint` : undefined}
          onFocus={() => setDraft(value === null ? '' : formatDue(value))}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            commit()
            // left unreadable: back to what is saved, the hint has had its say
            setDraft(null)
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); (e.currentTarget as HTMLInputElement).blur() }
            if (e.key === 'Escape' && draft !== null) { e.stopPropagation(); setDraft(null); (e.currentTarget as HTMLInputElement).blur() }
          }}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none',
            color: 'var(--color-text-base)', fontSize: 'var(--text-sm)',
            padding: 'var(--space-2) 0', outline: 'none'
          }}
        />
        {value !== null && !disabled && (
          <button
            type="button"
            className="btn-icon"
            title="Clear the due date"
            aria-label="Clear the due date"
            onClick={() => onChange(null)}
            style={{ width: '24px', height: '24px' }}
          >
            <X size={12} />
          </button>
        )}
        <button
          type="button"
          className="btn-icon"
          title="Pick from a calendar"
          aria-label="Pick the due date from a calendar"
          disabled={disabled}
          onClick={() => {
            const picker = pickerRef.current
            if (!picker) return
            try { picker.showPicker() } catch { picker.focus() }
          }}
          style={{ width: '24px', height: '24px' }}
        >
          <CalendarDays size={13} />
        </button>
        {/* the system calendar, opened by the button; a picked day stays a day, a timed due keeps its time */}
        <input
          ref={pickerRef}
          type="date"
          tabIndex={-1}
          aria-hidden
          value={dateInputValue(value)}
          onChange={e => onChange(fromDateInput(e.target.value, value))}
          style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }}
        />
      </div>
      {draft !== null && (
        <span id={id ? `${id}-hint` : undefined} className="text-micro-dim" aria-live="polite">
          {!draft.trim()
            ? 'Enter clears it. Try “tomorrow”, “fri 3pm” or “20 oct”'
            : reading === undefined
              ? 'Not a date I can read. Try “tomorrow”, “fri 3pm” or “20 oct”'
              : reading === null ? 'Enter clears it' : `Due ${formatDue(reading)}`}
        </span>
      )}
    </div>
  )
}
