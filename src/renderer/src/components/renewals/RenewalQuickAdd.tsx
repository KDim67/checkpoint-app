import { forwardRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { parseRenewalText, type RenewalGuess } from '../../../../shared/renewalText'
import { kindById, type RenewalKind } from '../../../../shared/renewalKinds'
import { shortDate } from '../../../../shared/renewalWarnings'

interface Props {
  kinds: RenewalKind[]
  /** true once it's made, so the box can clear */
  onAdd: (guess: RenewalGuess) => Promise<boolean>
}

/** typed the way it's said; the guess shows before Enter, so a wrong kind is caught while it's cheap */
const RenewalQuickAdd = forwardRef<HTMLInputElement, Props>(function RenewalQuickAdd({ kinds, onAdd }, ref) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const guess = draft.trim() ? parseRenewalText(draft) : null

  const submit = async (): Promise<void> => {
    if (!guess || !guess.title || adding) return
    setAdding(true)
    try {
      if (await onAdd(guess)) setDraft('')
    } finally {
      setAdding(false)
    }
  }

  const reading = guess && guess.title
    ? [
        kindById(kinds, guess.kind).name,
        guess.expiresAt !== undefined ? shortDate(guess.expiresAt) : guess.target ? 'date looked up' : null
      ].filter(Boolean).join(' · ')
    : null

  return (
    <form
      onSubmit={e => { e.preventDefault(); void submit() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0,
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
        placeholder="Add one: “acme.dev”, “openai key 20 jan”, “workspace sub 3 may”"
        aria-label="New renewal"
        style={{
          flex: 1, minWidth: 0, background: 'transparent', border: 'none',
          color: 'var(--color-text-base)', fontSize: 'var(--text-sm)',
          padding: 'var(--space-1) 0', outline: 'none'
        }}
      />
      {reading && <span className="renewal-chip" aria-live="polite">{reading}</span>}
      <button type="submit" className="btn-primary" disabled={!guess?.title || adding} style={{ padding: 'var(--space-1) var(--space-3)' }}>
        Add
      </button>
    </form>
  )
})

export default RenewalQuickAdd
